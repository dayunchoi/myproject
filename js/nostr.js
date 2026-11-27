/* ─────────────────────────────────────────────
   최소 Nostr 클라이언트 (NIP-01 / NIP-78)
   - 외부 CDN 없이 저장소에 포함된 noble-secp256k1 로 서명
   - 공용 릴레이 WebSocket 에 방(room) 단위 이벤트 publish / subscribe
   ───────────────────────────────────────────── */
import { getPublicKey, ProjectivePoint, utils } from '../lib/noble-secp256k1.js';

const te = new TextEncoder();
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

export function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function bytesToBig(bytes) {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) n = (n << 8n) + BigInt(bytes[i]);
  return n;
}
function bigToBytes(n, len = 32) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; }
  return out;
}
async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
async function taggedHash(tag, ...msgs) {
  const t = await sha256(te.encode(tag));
  return sha256(concat(t, t, ...msgs));
}

/** BIP-340 schnorr 서명 (32바이트 메시지 해시) */
async function schnorrSign(msg, sk, aux) {
  const pkBytes = getPublicKey(sk, true);
  const point = ProjectivePoint.fromHex(pkBytes);
  const { x: px, y: py } = point.toAffine();
  const d0 = bytesToBig(sk);
  const d = py % 2n === 0n ? d0 : N - d0;
  const auxHash = await taggedHash('BIP0340/aux', aux);
  const t = bigToBytes(d ^ bytesToBig(auxHash));
  const pxb = bigToBytes(px);
  const k0 = bytesToBig(await taggedHash('BIP0340/nonce', t, pxb, msg)) % N;
  if (k0 === 0n) throw new Error('schnorr nonce zero');
  const R = ProjectivePoint.BASE.multiply(k0);
  const ra = R.toAffine();
  const k = ra.y % 2n === 0n ? k0 : N - k0;
  const e = bytesToBig(await taggedHash('BIP0340/challenge', bigToBytes(ra.x), pxb, msg)) % N;
  const s = (k + e * d) % N;
  return { sig: concat(bigToBytes(ra.x), bigToBytes(s)), pubkey: bytesToHex(pkBytes).slice(2) };
}

function pubkeyOf(sk) {
  return bytesToHex(getPublicKey(sk, true)).slice(2);
}

function loadKey() {
  try {
    const saved = localStorage.getItem('po.nostrKey');
    if (saved && saved.length === 64) return hexToBytes(saved);
  } catch (_) {}
  const sk = utils.randomPrivateKey();
  try { localStorage.setItem('po.nostrKey', bytesToHex(sk)); } catch (_) {}
  return sk;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/* ── 이벤트 생성/서명 ── */
export async function makeEvent(kind, tags, content, sk) {
  const pubkey = pubkeyOf(sk);
  const created_at = nowSec();
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = bytesToHex(await sha256(te.encode(serialized)));
  const aux = crypto.getRandomValues(new Uint8Array(32));
  const { sig } = await schnorrSign(hexToBytes(id), sk, aux);
  return { id, pubkey, created_at, kind, tags, content, sig: bytesToHex(sig) };
}

export class NostrBus {
  constructor({ relays, room, onEvent, onStatus }) {
    this.relays = relays;
    this.room = room;
    this.topic = 'pickleoffice-' + room;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.sk = loadKey();
    this.pubkey = pubkeyOf(this.sk);
    this.outbox = [];
    this.sockets = new Map();
    this.seen = new Set();
    this.ready = 0;
    this.failed = 0;
    this.subId = 'po-' + Math.random().toString(36).slice(2, 8);
    this.closed = false;
  }

  relayStates() {
    return this.relays.map((url) => {
      const s = this.sockets.get(url);
      return { url, state: s ? s.state : 'idle' };
    });
  }

  emitStatus() {
    const states = this.relayStates();
    const ready = states.filter((s) => s.state === 'open').length;
    const connecting = states.filter((s) => s.state === 'connecting' || s.state === 'idle').length;
    this.onStatus?.({
      ready,
      total: states.length,
      connecting,
      states,
    });
  }

  start() {
    this.closed = false;
    for (const url of this.relays) this.open(url);
  }

  open(url) {
    if (this.closed) return;
    const prev = this.sockets.get(url);
    if (prev?.ws && (prev.ws.readyState === 0 || prev.ws.readyState === 1)) return;
    const rec = prev || { url, retry: 0, timer: null, ws: null, state: 'idle' };
    rec.state = 'connecting';
    this.sockets.set(url, rec);
    this.emitStatus();

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      this.scheduleRetry(rec);
      return;
    }
    rec.ws = ws;
    const connectTimer = setTimeout(() => {
      if (ws.readyState === 0) { try { ws.close(); } catch (_) {} }
    }, 8000);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      rec.state = 'open';
      rec.retry = 0;
      this.emitStatus();
      try {
        ws.send(JSON.stringify(['REQ', this.subId, {
          kinds: [30078],
          '#t': [this.topic],
          limit: 500,
        }]));
      } catch (_) {}
      this.flush(url);
    };
    ws.onmessage = (ev) => this.handle(url, ev.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(connectTimer);
      if (rec.state === 'open') rec.state = 'closed';
      else rec.state = 'failed';
      this.emitStatus();
      this.scheduleRetry(rec);
    };
  }

  scheduleRetry(rec) {
    if (this.closed || rec.timer) return;
    rec.retry = Math.min(rec.retry + 1, 6);
    const delay = Math.min(3000 * rec.retry, 25000);
    rec.timer = setTimeout(() => {
      rec.timer = null;
      this.open(rec.url);
    }, delay);
  }

  handle(url, raw) {
    let data;
    try { data = JSON.parse(raw); } catch (_) { return; }
    if (!Array.isArray(data)) return;
    const type = data[0];
    if (type === 'EVENT') {
      const ev = data[2];
      if (!ev || ev.kind !== 30078) return;
      if (this.seen.has(ev.id)) return;
      this.seen.add(ev.id);
      if (this.seen.size > 5000) this.seen.clear();
      let op = null;
      try { op = JSON.parse(ev.content); } catch (_) {}
      if (!op || !op.id) return;
      // 내가 보낸 이벤트는 로컬에서 이미 적용됨
      this.onEvent?.(op, ev);
    } else if (type === 'OK') {
      if (data[2] === false) {
        console.warn('[nostr] relay rejected', url, data[3]);
        const rec = this.sockets.get(url);
        if (rec) { rec.rejected = (rec.rejected || 0) + 1; }
      }
    } else if (type === 'NOTICE') {
      console.info('[nostr] notice', url, data[1]);
    } else if (type === 'CLOSED') {
      // 구독 종료 → 다음 연결에서 다시 REQ
    }
  }

  flush(url) {
    const rec = this.sockets.get(url);
    if (!rec?.ws || rec.ws.readyState !== 1) return;
    for (const ev of this.outbox) {
      try { rec.ws.send(JSON.stringify(['EVENT', ev])); } catch (_) {}
    }
  }

  async publish(op) {
    let ev;
    try {
      ev = await makeEvent(
        30078,
        [['d', `${this.room}-${op.id}`], ['t', this.topic], ['room', this.room]],
        JSON.stringify(op),
        this.sk
      );
    } catch (err) {
      console.warn('[nostr] sign failed', err);
      return;
    }
    this.outbox.push(ev);
    if (this.outbox.length > 30) this.outbox.shift();
    for (const [, rec] of this.sockets) {
      if (rec.ws && rec.ws.readyState === 1) {
        try { rec.ws.send(JSON.stringify(['EVENT', ev])); } catch (_) {}
      }
    }
  }

  close() {
    this.closed = true;
    for (const [, rec] of this.sockets) {
      if (rec.timer) clearTimeout(rec.timer);
      try { rec.ws?.close(); } catch (_) {}
    }
    this.sockets.clear();
  }
}
