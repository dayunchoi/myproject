/* ═══════════════════════════════════════════════════════════
   와플 & 피클 합동 비서실 — v3 (7 tabs · clay office)
   실제 접속한 피클끼리 일을 나누는 협업 사무실.
   실시간 동기화: Nostr 공용 릴레이(기본) / Firebase RTDB(선택)
   + BroadcastChannel + localStorage
   ═══════════════════════════════════════════════════════════ */
import { NostrBus } from './nostr.js?v=12';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14));

const DEFAULT_ROOM = 'dayun-office';
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net'];
const COLORS = ['#d8b4c4', '#a9c4e6', '#a8cdb4', '#e8c98e', '#d97d90', '#e3a988', '#b3b0dd', '#cfc4b8'];
const ZONES = {
  command: { left: 17, top: 8, right: 73, bottom: 43 },
  meeting: { left: 4, top: 33, right: 56, bottom: 88 },
  lounge: { left: 57, top: 32, right: 96, bottom: 87 },
};
const ZONE_LABEL = { meeting: '대회의실', command: '지휘실', lounge: '라운지' };
const ZONE_SPOT = { meeting: [26, 80], command: [46, 40], lounge: [74, 68] };
const STATUS_LABEL = { todo: '대기', doing: '진행 중', done: '완료' };
const LEGACY_ID = /^(demo-|seed-|fake-)/;
const PEER_REMEMBER_MS = 3 * 24 * 60 * 60 * 1000;
const PEER_RECENT_MS = 3 * 60 * 60 * 1000;
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/* 기본 루틴 — 다윤 님의 실제 scheduled-actions 기반 (예시 요원 아님) */
const ROUTINE_SEED = [
  { id: 'rt-d1', kind: 'daily', when: '08:00', title: '매일 아침 관심 뉴스 요약', note: '경제·금융 · IT·AI · 여행·항공 · 발레·전시 키워드' },
  { id: 'rt-d2', kind: 'daily', when: '09:05', title: '12월 올영세일 오픈 및 쿠폰 확인', note: '올리브영 12월 세일 첫날 · 쿠폰 3종 확인' },
  { id: 'rt-d3', kind: 'daily', when: '10:30', title: '네이버페이 매일 클릭 적립', note: '하루 1회 클릭 · 포인트 적립' },
  { id: 'rt-d4', kind: 'daily', when: '15:00', title: '매일 습관 루틴 챙기기(물·지출)', note: '물 마시기 권하기 · 오늘 지출 체크' },
  { id: 'rt-d5', kind: 'daily', when: '21:30', title: '카드 가계부 정기 기록', note: '카드 내역 정리 · 예산 대비 확인' },
  { id: 'rt-d6', kind: 'daily', when: '22:00', title: '매일 습관 루틴 챙기기(마감)', note: '오늘 습관 마감 · 내일 준비' },
  { id: 'rt-p1', kind: 'periodic', when: '11/29 10:00', title: '올리브영 포인트·네이버 리뷰 확인', note: '포인트 소멸 전 확인 · 리뷰 적립' },
  { id: 'rt-p2', kind: 'periodic', when: '11/30 23:50', title: '하나오카 1월 22일 예약 오픈', note: '오픈 10분 전 알림 · 예약 대기' },
  { id: 'rt-p3', kind: 'periodic', when: '12/07 13:50', title: '치이카와 팝업 2차 사전예약', note: '2차 사전예약 오픈 · 1차 매진' },
  { id: 'rt-p4', kind: 'periodic', when: '2027-01', title: '나고야 피치항공 운항', note: '피치항공 MM · 운항 스케줄 모니터링' },
  { id: 'rt-p5', kind: 'periodic', when: '2027-05', title: '제주 대한항공 체크인·운항', note: '체크인 오픈 · 창가 좌석' },
  { id: 'rt-p6', kind: 'periodic', when: '2027-09', title: '신혼여행 에미레이트 체크인·운항', note: '에미레이트 · 체크인·좌석 챙기기' },
];

/* ────────── 방 / 나 ────────── */
const params = new URLSearchParams(location.search);
const cleanRoom = (v) => (v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
let room = cleanRoom(params.get('room')) || cleanRoom(localStorage.getItem('po.room')) || DEFAULT_ROOM;
try { localStorage.setItem('po.room', room); } catch (_) {}

const meId = (() => {
  let id = localStorage.getItem('po.agentId');
  if (!id) { id = 'a-' + uid(); localStorage.setItem('po.agentId', id); }
  return id;
})();

const stateKey = 'po.state.6.' + room;
const peersKey = 'po.peers.4.' + room;
const seen = new Set();
let state = emptyState();
let mode = localStorage.getItem('po.mode') === 'firebase' ? 'firebase' : 'nostr';
let fbUrl = (localStorage.getItem('po.fbUrl') || '').trim().replace(/\/+$/, '');

function emptyState() {
  return {
    agents: {}, tasks: {}, todos: {}, messages: [],
    agenda: { text: '', updatedAt: 0 },
    memos: {}, limits: {}, routines: {},
  };
}

/* ────────── 최근 참여한 피클 기억 ────────── */
let knownPeers = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(peersKey) || '[]');
    return Array.isArray(raw) ? raw.filter((p) => p && p.id && !LEGACY_ID.test(p.id)) : [];
  } catch (_) { return []; }
})();

function rememberPeers() {
  const map = new Map(knownPeers.map((p) => [p.id, p]));
  for (const a of Object.values(state.agents)) {
    if (!a || a.id === meId || LEGACY_ID.test(a.id)) continue;
    map.set(a.id, {
      id: a.id,
      name: a.name || '피클',
      initial: a.initial || 'ㅇ',
      color: a.color || COLORS[0],
      status: a.status || '',
      lastSeen: a._seen || Date.now(),
    });
  }
  knownPeers = [...map.values()]
    .filter((p) => (p.lastSeen || 0) > Date.now() - PEER_REMEMBER_MS)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, 12);
  try { localStorage.setItem(peersKey, JSON.stringify(knownPeers)); } catch (_) {}
}
const recallPeer = (id) => knownPeers.find((p) => p.id === id) || null;

/* ────────── 내 피클 ────────── */
function readProfile() {
  try { return JSON.parse(localStorage.getItem('po.profile') || '{}'); } catch (_) { return {}; }
}

function ensureMe() {
  const t = Date.now();
  let a = state.agents[meId];
  if (!a) {
    const saved = readProfile();
    a = {
      id: meId,
      name: saved.name || '와플',
      initial: saved.initial || 'ㅇ',
      color: saved.color || COLORS[0],
      status: saved.status || '오늘도 옆에서 챙길게요',
      x: ZONE_SPOT.command[0], y: ZONE_SPOT.command[1], room: 'command',
      updatedAt: t,
    };
    state.agents[meId] = a;
  }
  a._seen = t;
  return a;
}

/* 예전 예시(더미) 데이터 청소 */
function purgeDemoData(s) {
  if (!s || typeof s !== 'object') return s;
  s.agents = s.agents && typeof s.agents === 'object' ? s.agents : {};
  s.tasks = s.tasks && typeof s.tasks === 'object' ? s.tasks : {};
  s.todos = s.todos && typeof s.todos === 'object' ? s.todos : {};
  s.memos = s.memos && typeof s.memos === 'object' ? s.memos : {};
  s.limits = s.limits && typeof s.limits === 'object' ? s.limits : {};
  s.routines = s.routines && typeof s.routines === 'object' ? s.routines : {};
  for (const id of Object.keys(s.agents)) {
    const a = s.agents[id];
    if (!a || a.demo || LEGACY_ID.test(id) || LEGACY_ID.test(a.id || '')) delete s.agents[id];
  }
  for (const id of Object.keys(s.tasks)) {
    const t = s.tasks[id];
    if (!t || t.demo || LEGACY_ID.test(id) || LEGACY_ID.test(t.owner || '')) delete s.tasks[id];
  }
  for (const id of Object.keys(s.todos)) {
    const t = s.todos[id];
    if (!t || LEGACY_ID.test(id)) delete s.todos[id];
  }
  s.messages = (Array.isArray(s.messages) ? s.messages : [])
    .filter((m) => m && !LEGACY_ID.test(m.id || '') && !LEGACY_ID.test(m.agentId || ''));
  return s;
}

function normalizeAgent(a) {
  if (!a) return a;
  if (!ZONE_SPOT[a.room]) {
    a.room = 'command';
    a.x = ZONE_SPOT.command[0];
    a.y = ZONE_SPOT.command[1];
  }
  a.x = clamp(Number(a.x) || ZONE_SPOT[a.room][0], 2, 98);
  a.y = clamp(Number(a.y) || ZONE_SPOT[a.room][1], 3, 96);
  return a;
}

function loadState() {
  let loaded = null;
  try {
    const raw = localStorage.getItem(stateKey);
    if (raw) loaded = JSON.parse(raw);
  } catch (_) {}
  if (loaded && loaded.agents) {
    state = purgeDemoData({ ...emptyState(), ...loaded });
    state.agenda = state.agenda || { text: '', updatedAt: 0 };
    state.messages = state.messages || [];
  } else {
    state = emptyState();
  }
  ensureMe();
  for (const a of Object.values(state.agents)) normalizeAgent(a);
  const savedProfile = readProfile();
  if (savedProfile.name) Object.assign(state.agents[meId], savedProfile);
  normalizeAgent(state.agents[meId]);
  rememberPeers();
  seedRoutines();
}

function seedRoutines() {
  let changed = false;
  ROUTINE_SEED.forEach((r, i) => {
    if (state.routines[r.id]) return;
    state.routines[r.id] = { ...r, enabled: true, order: i, updatedAt: 1 };
    changed = true;
  });
  if (changed) saveState();
}

/* ────────── 유틸 ────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, '0');
const timeHM = (ts) => {
  const d = new Date(ts || Date.now());
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const dateHM = (ts) => {
  const d = new Date(ts || Date.now());
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const short = (s, n = 14) => {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const isOnline = (a) => {
  if (!a) return false;
  if (a.id === meId) return true;
  return Date.now() - (a._seen || 0) < 75000;
};
const onlineAgents = () => Object.values(state.agents).filter(isOnline);
const ownerOf = (id) => state.agents[id] || recallPeer(id) || null;
const ownerName = (id) => ownerOf(id)?.name || '미지정';
const doingTaskOf = (id) =>
  Object.values(state.tasks)
    .filter((t) => t.owner === id && t.status === 'doing' && !t.deleted)
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0] || null;
const waitingCountOf = (id) =>
  Object.values(state.tasks).filter((t) => t.owner === id && t.status === 'todo' && !t.deleted).length;

function saveState() {
  try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch (_) {}
}

function toast(text) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, 2600);
}

/* ────────── 작업실 탭 배지 ────────── */
let badgeCount = 0;
function paintBadge() {
  const el = $('#workBadge');
  if (!el) return;
  el.textContent = badgeCount > 9 ? '9+' : String(badgeCount);
  el.hidden = badgeCount === 0;
}
function bumpBadge() { badgeCount += 1; paintBadge(); }
function clearBadge() { if (!badgeCount) return; badgeCount = 0; paintBadge(); }

/* ────────── op 적용 / 발행 ────────── */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

function notifyTask(prev, next, by) {
  if (!next || next.deleted) return;
  if (!by || by === meId) return;
  const from = ownerName(by);
  if (next.owner === meId && (!prev || prev.owner !== meId)) {
    toast(`📥 ${from} → 나 · "${short(next.title, 16)}"`);
    bumpBadge();
  } else if (prev && prev.owner === meId && next.owner === meId && next.status !== prev.status) {
    toast(`🔄 "${short(next.title, 16)}" · ${STATUS_LABEL[next.status] || next.status}`);
    bumpBadge();
  }
}

function applyOp(op, remote = false, createdAtSec = 0) {
  if (!op || !op.id || seen.has(op.id)) return false;
  seen.add(op.id);
  if (seen.size > 6000) seen.clear();
  const now = Date.now();
  const seenTs = remote && createdAtSec ? Math.min(createdAtSec * 1000, now) : now;
  let changed = false;

  if (op.type === 'agent' && op.agent) {
    const a = op.agent;
    if (!a.id || LEGACY_ID.test(a.id)) return false;
    const cur = state.agents[a.id];
    const isNewPeer = !cur && a.id !== meId;
    if (!cur || (a.updatedAt || 0) >= (cur.updatedAt || 0)) {
      const prevSeen = cur?._seen || 0;
      state.agents[a.id] = normalizeAgent({ ...(cur || {}), ...a, _seen: Math.max(prevSeen, seenTs) });
      changed = true;
    } else if (remote) {
      cur._seen = Math.max(cur._seen || 0, seenTs);
      changed = true;
    }
    if (isNewPeer && op.by !== meId && now - seenTs < 90000) toast(`👋 ${a.name || '피클'} 피클이 들어왔어요`);
    if (a.id !== meId) rememberPeers();
  } else if (op.type === 'agenda' && op.agenda) {
    if ((op.agenda.updatedAt || 0) >= (state.agenda.updatedAt || 0)) {
      state.agenda = { ...op.agenda };
      changed = true;
    }
  } else if (op.type === 'chat' && op.msg) {
    if (LEGACY_ID.test(op.msg.agentId || '')) return false;
    if (!state.messages.some((m) => m.id === op.msg.id)) {
      state.messages.push(op.msg);
      state.messages.sort((x, y) => x.ts - y.ts);
      if (state.messages.length > 300) state.messages = state.messages.slice(-300);
      changed = true;
    }
  } else if (op.type === 'todo' && op.todo) {
    const cur = state.todos[op.todo.id];
    if (!cur || (op.todo.updatedAt || 0) >= (cur.updatedAt || 0)) {
      state.todos[op.todo.id] = { ...op.todo };
      changed = true;
    }
  } else if (op.type === 'task' && op.task) {
    const next = op.task;
    if (!next.id || LEGACY_ID.test(next.id)) return false;
    const cur = state.tasks[next.id];
    if (!cur || (next.updatedAt || 0) >= (cur.updatedAt || 0)) {
      state.tasks[next.id] = { ...next };
      changed = true;
      if (remote) notifyTask(cur, next, op.by);
    }
  } else if (op.type === 'memo' && op.memo) {
    const m = op.memo;
    if (!m.id || LEGACY_ID.test(m.id)) return false;
    const cur = state.memos[m.id];
    if (!cur || (m.updatedAt || 0) >= (cur.updatedAt || 0)) {
      state.memos[m.id] = { ...m };
      changed = true;
    }
  } else if (op.type === 'limit' && op.limit) {
    const l = op.limit;
    if (!l.id) return false;
    const cur = state.limits[l.id];
    if (!cur || (l.updatedAt || 0) >= (cur.updatedAt || 0)) {
      state.limits[l.id] = { ...l };
      changed = true;
    }
  } else if (op.type === 'routine' && op.routine) {
    const r = op.routine;
    if (!r.id) return false;
    const cur = state.routines[r.id];
    if (!cur || (r.updatedAt || 0) >= (cur.updatedAt || 0)) {
      state.routines[r.id] = { ...r };
      changed = true;
    }
  }

  if (changed) { saveState(); scheduleRender(); }
  return changed;
}

function publishOp(op) {
  try { bc?.postMessage(op); } catch (_) {}
  if (mode === 'nostr' && bus) bus.publish(op);
  else if (mode === 'firebase' && fbUrl) scheduleFbPush();
}

function push(op) {
  const changed = applyOp(op, false);
  publishOp(op);
  return changed;
}

function emit(type, payload) {
  push({ id: uid(), ts: Date.now(), by: meId, type, ...payload });
}

function publishMe(extra = {}) {
  const a = state.agents[meId];
  if (!a) return;
  const clean = { ...a, ...extra };
  delete clean._seen;
  emit('agent', { agent: clean });
}
let moveTimer = null;
function publishMeThrottled() {
  if (moveTimer) return;
  moveTimer = setTimeout(() => { moveTimer = null; publishMe(); }, 240);
}

/* ────────── 동기화 ────────── */
let bus = null;
let bc = null;
let fb = { es: null, timer: null, lastRev: 0, active: false };

function setConn(ready, total, connecting) {
  const pill = $('#statusPill');
  if (pill) {
    pill.classList.remove('warn', 'off');
    if (!ready) pill.classList.add(connecting ? 'warn' : 'off');
  }
  const dot = $('#syncDot');
  if (dot) dot.style.background = ready ? 'var(--green)' : connecting ? 'var(--amber)' : 'var(--muted)';
  const txt = $('#syncText');
  if (txt) {
    if (mode === 'firebase') txt.textContent = ready ? '실시간 연결 · Firebase RTDB' : connecting ? 'Firebase 연결 중…' : '로컬 모드';
    else txt.textContent = ready ? `실시간 연결 · Nostr ${ready}/${total}` : connecting ? '연결 중…' : '로컬 모드 (릴레이 연결 실패)';
  }
  renderRelayList();
}

function startNostr() {
  stopFirebase();
  if (bus) bus.close();
  if (!bc) {
    try {
      bc = new BroadcastChannel('pickleoffice3-' + room);
      bc.onmessage = (e) => applyOp(e.data, true);
    } catch (_) { bc = null; }
  }
  setConn(0, RELAYS.length, true);
  bus = new NostrBus({
    relays: RELAYS,
    room,
    onEvent: (op, ev) => applyOp(op, true, ev?.created_at),
    onStatus: ({ ready, total, connecting }) => setConn(ready, total, connecting > 0),
  });
  bus.start();
  setTimeout(() => { publishMe(); saveState(); }, 1800);
}

function renderRelayList() {
  const box = $('#relayList');
  if (!box) return;
  const states = bus ? bus.relayStates() : RELAYS.map((url) => ({ url, state: 'idle' }));
  const map = { open: 'ok', connecting: '', idle: '', closed: 'bad', failed: 'bad' };
  box.innerHTML = states
    .map((s) => `<div class="relay ${map[s.state] || ''}"><i></i><span>${esc(s.url.replace('wss://', ''))}</span></div>`)
    .join('');
}

/* Firebase (선택) */
function fbPath() { return `${fbUrl}/pickleOffice/${encodeURIComponent(room)}.json`; }
function scheduleFbPush() {
  if (mode !== 'firebase' || !fbUrl) return;
  clearTimeout(fb.timer);
  fb.timer = setTimeout(fbPush, 500);
}
async function fbPush() {
  if (!fbUrl) return;
  const doc = {
    rev: Date.now(),
    agents: state.agents, tasks: state.tasks, todos: state.todos, agenda: state.agenda,
    messages: state.messages.slice(-150),
    memos: state.memos, limits: state.limits, routines: state.routines,
  };
  fb.lastRev = doc.rev;
  try {
    const res = await fetch(fbPath(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) { console.warn('[firebase] push failed', e); }
}
function adoptRemote(doc) {
  if (!doc || typeof doc !== 'object' || !doc.agents) return;
  if ((doc.rev || 0) <= fb.lastRev) return;
  fb.lastRev = doc.rev || 0;
  state = purgeDemoData({
    agents: doc.agents || {}, tasks: doc.tasks || {}, todos: doc.todos || {},
    agenda: doc.agenda || { text: '', updatedAt: 0 },
    messages: Array.isArray(doc.messages) ? doc.messages : [],
    memos: doc.memos || {}, limits: doc.limits || {}, routines: doc.routines || {},
  });
  ensureMe();
  for (const a of Object.values(state.agents)) normalizeAgent(a);
  rememberPeers();
  saveState();
  scheduleRender();
}
function stopFirebase() {
  if (fb.es) { try { fb.es.close(); } catch (_) {} fb.es = null; }
  fb.active = false;
}
async function startFirebase() {
  if (!fbUrl) { toast('Firebase URL을 먼저 넣어주세요'); return; }
  if (bus) { bus.close(); bus = null; }
  if (!bc) {
    try {
      bc = new BroadcastChannel('pickleoffice3-' + room);
      bc.onmessage = (e) => applyOp(e.data, true);
    } catch (_) { bc = null; }
  }
  stopFirebase();
  fb.active = true;
  setConn(0, 1, true);
  try {
    const res = await fetch(fbPath(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data) adoptRemote(data);
  } catch (e) {
    setConn(0, 1, false);
    toast('Firebase 연결 실패 — URL과 규칙을 확인해 주세요');
    return;
  }
  try {
    const es = new EventSource(fbPath());
    fb.es = es;
    es.onopen = () => setConn(1, 1, false);
    es.onerror = () => setConn(0, 1, true);
    es.addEventListener('put', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed && parsed.path === '/') adoptRemote(parsed.data);
      } catch (_) {}
    });
  } catch (e) { setConn(0, 1, false); }
  setTimeout(() => { publishMe(); saveState(); }, 600);
}

function startSync() {
  if (mode === 'firebase' && fbUrl) startFirebase();
  else startNostr();
}

/* ══════════ 렌더: 헤더 ══════════ */
function statusCounts() {
  const online = onlineAgents();
  const total = new Set([meId, ...online.map((a) => a.id), ...knownPeers.map((p) => p.id)]).size;
  const idle = online.filter((a) => !doingTaskOf(a.id)).length;
  return { total, online: online.length, idle };
}

function renderHeader() {
  const me = state.agents[meId];
  if (me) {
    const av = $('#meAvatar');
    av.textContent = me.initial || 'ㅇ';
    av.style.setProperty('--c', me.color || COLORS[0]);
    $('#meName').textContent = me.name || '와플';
  }
  const c = statusCounts();
  $('#statusText').textContent = `비서 ${c.total}명 · 온라인 ${c.online} · 대기 ${c.idle}`;
}

function renderClock() {
  const d = new Date();
  $('#clockText').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/* ══════════ 렌더: 오피스 맵 ══════════ */
const agentEls = new Map();

function paintAgentEl(el, a, spot) {
  el.style.left = spot.x + '%';
  el.style.top = spot.y + '%';
  el.style.setProperty('--c', a.color || COLORS[0]);
  el.classList.toggle('me', a.id === meId);
  el.classList.toggle('offline', !isOnline(a));
  const dot = el.querySelector('.tag i');
  if (dot) dot.style.background = a.color || COLORS[0];
  const nm = el.querySelector('.tag span');
  const nmText = a.id === meId ? `${a.name} (나)` : a.name;
  if (nm.textContent !== nmText) nm.textContent = nmText;
  const doing = doingTaskOf(a.id);
  el.title = `${a.name} · ${ZONE_LABEL[a.room] || '지휘실'} · ${doing ? '진행 중: ' + doing.title : '대기 중'}${a.id === meId ? '' : ' · 클릭해서 일 맡기기'}`;
}

function renderAgents() {
  const layer = $('#agentLayer');
  if (!layer) return;
  const alive = new Set();
  const staleBefore = Date.now() - 10 * 60 * 1000;
  for (const [id, a] of Object.entries(state.agents)) {
    if (id !== meId && (a._seen || 0) < staleBefore) { delete state.agents[id]; saveState(); }
  }
  const list = Object.values(state.agents)
    .filter((a) => a.id === meId || isOnline(a))
    .sort((a, b) => (a.id === meId ? 1 : b.id === meId ? -1 : 0));

  const placed = [];
  const spots = new Map();
  for (const a of list) {
    let x = a.x ?? ZONE_SPOT[a.room][0];
    let y = a.y ?? ZONE_SPOT[a.room][1];
    let guard = 0;
    while (placed.some((p) => Math.abs(p.x - x) < 9 && Math.abs(p.y - y) < 10) && guard < 16) {
      x += 9;
      y += guard % 2 === 0 ? 8 : -9;
      if (x > 92) { x = 8 + (guard % 3) * 7; y += 10; }
      y = clamp(y, 7, 93);
      guard += 1;
    }
    placed.push({ x, y });
    spots.set(a.id, { x, y });
  }

  for (const a of list) {
    alive.add(a.id);
    let el = agentEls.get(a.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'agent';
      el.dataset.agent = a.id;
      el.innerHTML = `
        <span class="me-mark" aria-hidden="true">나</span>
        <div class="tag"><i></i><span></span></div>
        <div class="body"><span class="eye l"></span><span class="eye r"></span><span class="mouth"></span></div>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (a.id === meId) openProfile();
        else openAssign(a.id);
      });
      layer.appendChild(el);
      agentEls.set(a.id, el);
    }
    paintAgentEl(el, a, spots.get(a.id) || { x: a.x, y: a.y });
  }
  for (const [id, el] of agentEls) {
    if (!alive.has(id)) { el.remove(); agentEls.delete(id); }
  }
}

function zoneAt(x, y) {
  for (const name of ['command', 'meeting', 'lounge']) {
    const z = ZONES[name];
    if (x >= z.left && x <= z.right && y >= z.top && y <= z.bottom) return name;
  }
  return null;
}

function moveMe(x, y) {
  const a = state.agents[meId];
  if (!a) return;
  a.x = clamp(x, 2, 98);
  a.y = clamp(y, 3, 96);
  a.room = zoneAt(a.x, a.y) || a.room;
  a.updatedAt = Date.now();
  renderAgents();
  saveState();
  publishMeThrottled();
}

function enterZone(zone) {
  const [x, y] = ZONE_SPOT[zone];
  moveMe(x, y);
  const a = state.agents[meId];
  if (a) { a.room = zone; a.updatedAt = Date.now(); publishMe(); }
  renderAgents();
  if (zone === 'meeting') { switchTab('meeting'); toast('🏛️ 대회의실로 이동했어요'); }
  else if (zone === 'command') { switchTab('work'); toast('💻 지휘실로 이동했어요'); }
  else toast('☕ 라운지 — 잠깐 쉬어가는 중');
}

/* ══════════ 렌더: 회의실 ══════════ */
function renderMeeting() {
  const participants = onlineAgents().filter((a) => a.room === 'meeting');
  $('#partCount').textContent = `${participants.length}명`;
  const pSig = participants.map((a) => a.id + a.name + a.initial).join('|');
  const pBox = $('#participantList');
  if (pBox.dataset.sig !== pSig) {
    pBox.dataset.sig = pSig;
    pBox.innerHTML = participants.length
      ? participants.map((a) => `<span class="chip ${a.id === meId ? 'me' : ''}" style="--c:${esc(a.color)}"><i>${esc(a.initial)}</i>${esc(a.name)}${a.id === meId ? '<span class="away">나</span>' : ''}</span>`).join('')
      : '<span class="chip"><i style="--c:#b3a293">·</i>아직 아무도 없어요</span>';
  }

  const agendaInput = $('#agendaInput');
  if (document.activeElement !== agendaInput) agendaInput.value = state.agenda.text || '';

  const list = $('#chatList');
  const inner = $('#chatInner');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  const msgs = state.messages.slice(-200);
  $('#chatHint').hidden = msgs.length > 0;
  inner.hidden = msgs.length === 0;
  const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
  if (inner.dataset.sig !== lastId + ':' + msgs.length) {
    inner.innerHTML = msgs.map((m) => `
      <div class="msg ${m.agentId === meId ? 'mine' : ''}">
        <div class="mav" style="--c:${esc(m.color || COLORS[0])}">${esc(m.initial || 'ㅇ')}</div>
        <div class="mb">
          <div class="mh"><span class="mn">${esc(m.name)}</span><span class="mt">${timeHM(m.ts)}</span></div>
          <div class="mx">${esc(m.text)}</div>
        </div>
      </div>`).join('');
    inner.dataset.sig = lastId + ':' + msgs.length;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  const todos = Object.values(state.todos).filter((t) => !t.deleted)
    .sort((a, b) => (a.done === b.done ? (a.updatedAt || 0) - (b.updatedAt || 0) : a.done ? 1 : -1));
  const done = todos.filter((t) => t.done).length;
  $('#todoProgress').style.width = todos.length ? `${(done / todos.length) * 100}%` : '0%';
  $('#todoProgressText').textContent = `${done} / ${todos.length} 완료`;
  const tSig = todos.map((t) => `${t.id}:${t.done}:${t.text}`).join('|');
  const tBox = $('#todoList');
  if (tBox.dataset.sig !== tSig) {
    tBox.dataset.sig = tSig;
    tBox.innerHTML = todos.map((t) => `
      <li class="${t.done ? 'done' : ''}" data-todo="${esc(t.id)}">
        <button class="cb" data-act="toggle" aria-label="완료">✓</button>
        <span class="tt">${esc(t.text)}</span>
        <button class="del" data-act="del" title="삭제">✕</button>
      </li>`).join('') || '<li class="todo-empty">아직 결정사항이 없어요</li>';
  }
}

/* ══════════ 렌더: 작업실 ══════════ */
function cardHTML(t) {
  const owner = ownerOf(t.owner);
  const mine = t.owner === meId;
  const pCls = t.priority === '높음' ? 'high' : t.priority === '낮음' ? 'low' : 'mid';
  const moves = [];
  if (t.status === 'todo') moves.push(['doing', '▶', '시작']);
  if (t.status === 'doing') { moves.push(['todo', '◀', '대기로']); moves.push(['done', '✓', '완료']); }
  if (t.status === 'done') moves.push(['doing', '↺', '되돌리기']);
  return `
    <article class="card ${t.status === 'done' ? 'done' : ''} ${mine ? 'mine' : ''}" draggable="true" data-task="${esc(t.id)}">
      <div class="ch">
        <span class="prio ${pCls}">${esc(t.priority || '보통')}</span>
        <span class="who"><i style="--c:${esc(owner?.color || '#b3a293')}">${esc(owner?.initial || '·')}</i>${esc(owner?.name || '미지정')}</span>
        ${mine ? '<span class="my-tag">내 작업</span>' : ''}
      </div>
      <div class="ct">${esc(t.title)}</div>
      ${t.note ? `<div class="cn">${esc(t.note)}</div>` : ''}
      <div class="cf">
        <select class="opick" data-owner title="담당 피클 변경">${ownerOptionsHTML(t.owner)}</select>
        ${mine || t.status === 'done' ? '' : '<button class="mv take" data-take="1" title="내가 맡기">내가 맡기</button>'}
        ${moves.map(([s, icon, label]) => `<button class="mv" data-move="${s}" title="${label}">${icon}</button>`).join('')}
        <button class="mv del" data-del="1" title="삭제">🗑</button>
      </div>
    </article>`;
}

function renderKanban() {
  const tasks = Object.values(state.tasks).filter((t) => !t.deleted);
  const rosterSig = assignableList().map((a) => a.id + ':' + a.label).join(',');
  const sig = tasks.map((t) => `${t.id}:${t.status}:${t.updatedAt}:${t.title}:${t.note || ''}:${t.owner}:${t.priority}`).join('|') + '||' + rosterSig;
  const board = $('#kanban');
  if (board.dataset.sig === sig) return;
  board.dataset.sig = sig;
  const note = $('#kanbanNote');
  if (note) note.hidden = tasks.length > 0;
  for (const status of ['todo', 'doing', 'done']) {
    const items = tasks.filter((t) => t.status === status).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const box = $('#col-' + status);
    $(`[data-count="${status}"]`).textContent = String(items.length);
    const emptyText = {
      todo: ['🗂️', '대기 중인 작업이 없어요'],
      doing: ['⚡', '진행 중인 작업이 없어요'],
      done: ['🎉', '완료된 작업이 없어요'],
    }[status];
    box.innerHTML = items.length
      ? items.map((t) => cardHTML(t)).join('')
      : `<div class="empty-col"><span class="e">${emptyText[0]}</span>${emptyText[1]}</div>`;
  }
}

/* ────────── 담당 피클 목록 ────────── */
function assignableList() {
  const rows = [];
  const me = state.agents[meId];
  if (me) rows.push({ id: me.id, label: `${me.name} (나)`, state: 'me' });
  Object.values(state.agents)
    .filter((a) => a.id !== meId && isOnline(a))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'))
    .forEach((a) => rows.push({ id: a.id, label: `${a.name} · 접속 중`, state: 'on' }));
  const listed = new Set(rows.map((r) => r.id));
  knownPeers
    .filter((p) => !listed.has(p.id) && p.id !== meId && (p.lastSeen || 0) > Date.now() - PEER_RECENT_MS)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, 6)
    .forEach((p) => rows.push({ id: p.id, label: `${p.name || '피클'} · 최근 참여`, state: 'off' }));
  return rows;
}

function ownerOptionsHTML(selected) {
  const rows = assignableList();
  let html = `<option value=""${!selected ? ' selected' : ''}>미배정</option>`;
  html += rows.map((r) => `<option value="${esc(r.id)}"${r.id === selected ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
  if (selected && !rows.some((r) => r.id === selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(ownerOf(selected)?.name || '알 수 없는 피클')}</option>`;
  }
  return html;
}

function fillOwnerSelect(sel) {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = ownerOptionsHTML(cur);
}

/* ══════════ 렌더: 비서현황 ══════════ */
function assistantList() {
  const map = new Map();
  const me = state.agents[meId];
  if (me) map.set(me.id, { ...me, online: true });
  for (const a of Object.values(state.agents)) {
    if (a.id === meId || LEGACY_ID.test(a.id)) continue;
    map.set(a.id, { ...a, online: isOnline(a) });
  }
  for (const p of knownPeers) {
    if (map.has(p.id)) continue;
    map.set(p.id, {
      id: p.id, name: p.name, initial: p.initial, color: p.color,
      status: p.status || '', room: 'command', online: false, lastSeen: p.lastSeen,
    });
  }
  return [...map.values()].sort((a, b) => {
    if (a.id === meId) return -1;
    if (b.id === meId) return 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function renderAgentCards() {
  const grid = $('#agentGrid');
  if (!grid) return;
  const rows = assistantList();
  grid.innerHTML = rows.map((a) => {
    const doing = doingTaskOf(a.id);
    const waiting = waitingCountOf(a.id);
    const isMe = a.id === meId;
    return `
      <article class="acard">
        <div class="acard-head">
          <span class="acard-av" style="--c:${esc(a.color || COLORS[0])}">${esc(a.initial || 'ㅇ')}</span>
          <div class="acard-id">
            <b>${esc(a.name || '피클')}${isMe ? '<span class="me-badge">나</span>' : ''}</b>
            <span>자음 ${esc(a.initial || 'ㅇ')} · <i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${esc(a.color || COLORS[0])}"></i> ${esc(a.color || '')}</span>
          </div>
          <span class="acard-state ${a.online ? 'on' : 'off'}">${a.online ? '온라인' : '최근 참여'}</span>
        </div>
        <div class="acard-rows">
          <div class="row"><i>📍</i><span><b>위치</b> · ${esc(ZONE_LABEL[a.room] || '지휘실')}</span></div>
          <div class="row"><i>⚡</i><span>${doing ? `<b>진행 중</b> · ${esc(doing.title)}` : `<b>대기 중</b> · 맡은 작업 없음${waiting ? ` · 대기 ${waiting}건` : ''}`}</span></div>
          <div class="row"><i>💬</i><span>${a.status ? esc(a.status) : '<span style="color:var(--muted)">상태 메시지 없음</span>'}</span></div>
        </div>
        <div class="acard-foot">
          ${isMe
            ? '<button class="ghost-btn" data-edit-me="1">내 프로필 수정</button>'
            : `<button class="ghost-btn" data-assign="${esc(a.id)}">일 맡기기</button>`}
        </div>
      </article>`;
  }).join('');
}

/* ══════════ 렌더: AI한도 ══════════ */
function limitOf(id) {
  return state.limits[id] || null;
}
function gaugeClass(v) {
  if (v == null) return '';
  if (v <= 20) return 'low';
  if (v <= 50) return 'warn';
  return '';
}
function stateClass(s) {
  return s === '주의' ? 'warn' : s === '한도 임박' || s === '소진' ? 'low' : 'ok';
}

function renderLimits(force = false) {
  const grid = $('#limitGrid');
  if (!grid) return;
  if (!force && grid.contains(document.activeElement)) return;
  const rows = assistantList();
  grid.innerHTML = rows.map((a) => {
    const l = limitOf(a.id);
    const isMe = a.id === meId;
    const daily = l && typeof l.daily === 'number' ? l.daily : null;
    const weekly = l && typeof l.weekly === 'number' ? l.weekly : null;
    const lstate = l?.state || (l ? '정상' : '미기록');
    return `
      <article class="lcard ${isMe ? 'mine' : ''}">
        <div class="lhead">
          <span class="acard-av" style="--c:${esc(a.color || COLORS[0])}">${esc(a.initial || 'ㅇ')}</span>
          <div>
            <b>${esc(a.name || '피클')}${isMe ? '<span class="me-badge">나</span>' : ''}</b>
            <span class="sub">${a.online ? '온라인' : '최근 참여'} · ${esc(ZONE_LABEL[a.room] || '지휘실')}</span>
          </div>
          <span class="lstate ${l ? stateClass(lstate) : ''}">${esc(lstate)}</span>
        </div>

        <div class="gauge-row">
          <div class="gauge-top"><span>일일 잔여</span><em>${daily == null ? '아직 기록 없음' : daily + '%'}</em></div>
          <div class="gauge"><div class="${gaugeClass(daily)}" style="width:${daily == null ? 0 : daily}%"></div></div>
        </div>
        <div class="gauge-row">
          <div class="gauge-top"><span>주간 잔여</span><em>${weekly == null ? '아직 기록 없음' : weekly + '%'}</em></div>
          <div class="gauge"><div class="${gaugeClass(weekly)}" style="width:${weekly == null ? 0 : weekly}%"></div></div>
        </div>

        ${l?.note ? `<div class="lnote">${esc(l.note)}</div>` : ''}

        ${isMe ? `
        <div class="lform">
          <label>일일 잔여 %<input id="lmDaily" type="number" min="0" max="100" value="${daily == null ? 100 : daily}"></label>
          <label>주간 잔여 %<input id="lmWeekly" type="number" min="0" max="100" value="${weekly == null ? 100 : weekly}"></label>
          <label>상태
            <select id="lmState">
              ${['정상', '주의', '한도 임박', '소진'].map((s) => `<option${s === lstate ? ' selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
          <label>메모<input id="lmNote" maxlength="60" value="${esc(l?.note || '')}" placeholder="예: 오전에 무거운 작업 몰아서"></label>
          <div class="lform-foot wide"><span class="ok" id="lmSaved"></span><button class="primary-btn" id="lmSave">한도 기록</button></div>
        </div>` : `<div class="laid">${l ? `마지막 기록 ${timeHM(l.updatedAt)}` : '본인이 기록하면 여기에 표시돼요'}</div>`}
      </article>`;
  }).join('');
}

/* ══════════ 렌더: 메모 ══════════ */
function renderMemos() {
  const grid = $('#memoGrid');
  if (!grid) return;
  const rows = Object.values(state.memos).filter((m) => !m.deleted)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!rows.length) {
    grid.innerHTML = '<div class="memo-empty">아직 메모가 없어요. 위에서 첫 메모를 남겨보세요.</div>';
    return;
  }
  grid.innerHTML = rows.map((m) => `
    <article class="mcard ${m.pinned ? 'pinned' : ''}" data-memo="${esc(m.id)}">
      <div class="mc-head">
        <h3>${esc(m.title)}</h3>
        <button class="pin-btn ${m.pinned ? 'on' : ''}" data-pin="1" title="고정">📌</button>
      </div>
      ${m.body ? `<div class="mc-body">${esc(m.body)}</div>` : ''}
      <div class="mc-foot">
        <span class="who2" style="--c:${esc(m.color || COLORS[0])}"><i>${esc(m.initial || 'ㅇ')}</i>${esc(m.author || '피클')}</span>
        <span class="time">${dateHM(m.updatedAt)}</span>
        <button class="mdel" data-mdel="1" title="삭제">✕</button>
      </div>
    </article>`).join('');
}

/* ══════════ 렌더: 루틴 ══════════ */
const parseHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return 9999;
  return Number(m[1]) * 60 + Number(m[2]);
};

function routineList(kind) {
  return Object.values(state.routines)
    .filter((r) => !r.deleted && r.kind === kind)
    .sort((a, b) => (a.kind === 'daily' ? parseHM(a.when) - parseHM(b.when) : (a.order || 0) - (b.order || 0)));
}

function nextRoutine() {
  const daily = routineList('daily').filter((r) => r.enabled !== false && parseHM(r.when) < 9999);
  if (!daily.length) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const later = daily.find((r) => parseHM(r.when) > mins);
  if (later) return { r: later, tomorrow: false };
  return { r: daily[0], tomorrow: true };
}

function routineItemHTML(r) {
  const off = r.enabled === false;
  return `
    <li class="rt-item ${r.kind === 'periodic' ? 'periodic' : ''} ${off ? 'off' : ''}" data-rid="${esc(r.id)}">
      <span class="rt-time">${esc(r.when)}</span>
      <div class="rt-body">
        <b>${esc(r.title)}</b>
        ${r.note ? `<span>${esc(r.note)}</span>` : ''}
      </div>
      <button class="rt-toggle ${off ? '' : 'on'}" data-rtoggle="1" title="${off ? '켜기' : '끄기'}">✓</button>
      <button class="rt-del" data-rdel="1" title="삭제">✕</button>
    </li>`;
}

function renderRoutines() {
  const daily = routineList('daily');
  const weekly = routineList('weekly');
  const periodic = routineList('periodic');
  const total = daily.length + weekly.length + periodic.length;

  $('#routineTotal').textContent = `합계 ${total}개`;
  $('#sumDaily').textContent = String(daily.length);
  $('#sumWeekly').textContent = String(weekly.length);
  $('#sumPeriodic').textContent = String(periodic.length);
  $('#dailyCount').textContent = `${daily.length}개`;
  $('#periodicCount').textContent = `${periodic.length}개`;

  const emptyRow = (text) => `<li class="rt-item"><div class="rt-body"><b style="color:var(--muted);font-weight:600">${text}</b></div></li>`;
  $('#dailyList').innerHTML = daily.length ? daily.map(routineItemHTML).join('') : emptyRow('아직 매일 루틴이 없어요');
  $('#periodicList').innerHTML = periodic.length ? periodic.map(routineItemHTML).join('') : emptyRow('아직 예약 루틴이 없어요');

  const nx = nextRoutine();
  const banner = $('#nextBanner');
  if (!nx) {
    banner.innerHTML = '<span class="nb-icon">⏰</span><span class="nb-text">아직 등록된 매일 루틴이 없어요</span>';
  } else {
    banner.innerHTML = `<span class="nb-icon">⏰</span><span class="nb-text">다음 루틴 · ${esc(nx.r.when)} ${esc(nx.r.title)} (${nx.tomorrow ? '내일' : '오늘'})</span>`;
  }
}

/* ══════════ 전체 렌더 ══════════ */
function renderAll() {
  renderHeader();
  renderAgents();
  renderMeeting();
  renderKanban();
  renderAgentCards();
  renderLimits();
  renderMemos();
  renderRoutines();
}

/* ══════════ 탭 ══════════ */
function switchTab(tab) {
  $$('.tabrow button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
  if (tab === 'meeting') {
    const list = $('#chatList');
    list.scrollTop = list.scrollHeight;
    if (state.agents[meId] && state.agents[meId].room !== 'meeting') {
      const a = state.agents[meId];
      [a.x, a.y] = ZONE_SPOT.meeting; a.room = 'meeting'; a.updatedAt = Date.now();
      renderAgents(); saveState(); publishMe();
    }
  }
  if (tab === 'work') {
    clearBadge();
    const a = state.agents[meId];
    if (a && a.room !== 'command') {
      [a.x, a.y] = ZONE_SPOT.command; a.room = 'command'; a.updatedAt = Date.now();
      renderAgents(); saveState(); publishMe();
    }
    fillOwnerSelect($('#taskOwner'));
  }
  if (tab === 'agents') renderAgentCards();
  if (tab === 'limits') renderLimits(true);
  if (tab === 'memo') renderMemos();
  if (tab === 'routine') renderRoutines();
}

/* ══════════ 프로필 모달 ══════════ */
let pfColor = COLORS[0];
function openProfile() {
  const a = state.agents[meId];
  if (!a) return;
  $('#pfName').value = a.name || '';
  $('#pfInitial').value = a.initial || '';
  $('#pfStatus').value = a.status || '';
  pfColor = a.color || COLORS[0];
  selectColor(pfColor);
  updatePreview();
  openModal('profileModal');
}
function selectColor(c) {
  pfColor = c;
  $$('#pfColors button').forEach((b) => b.classList.toggle('sel', b.dataset.color === c));
}
function updatePreview() {
  const name = $('#pfName').value.trim() || '피클';
  const initial = ($('#pfInitial').value.trim() || 'ㅇ').slice(0, 1);
  const status = $('#pfStatus').value.trim() || '상태 메시지';
  $('#pvName').textContent = name;
  $('#pvInitial').textContent = initial;
  $('#pvBubble').textContent = status.length > 18 ? status.slice(0, 18) + '…' : status;
  const pv = $('#pvAgent');
  pv.style.setProperty('--c', pfColor);
  $('#pvInitial').style.setProperty('--c', pfColor);
}
function saveProfile() {
  const a = state.agents[meId];
  if (!a) return;
  const name = $('#pfName').value.trim() || '와플';
  const initial = ($('#pfInitial').value.trim() || 'ㅇ').slice(0, 1);
  const status = $('#pfStatus').value.trim();
  const profile = { name, initial, color: pfColor, status };
  try { localStorage.setItem('po.profile', JSON.stringify(profile)); } catch (_) {}
  Object.assign(a, profile, { updatedAt: Date.now() });
  publishMe();
  saveState();
  renderAll();
  closeModal('profileModal');
  toast('프로필을 저장했어요 ✨');
}

/* ══════════ 일 맡기기 모달 ══════════ */
let assignTargetId = null;

function openAssign(id) {
  const a = state.agents[id] || recallPeer(id);
  if (!a || id === meId) return;
  assignTargetId = id;
  const av = $('#asAvatar');
  av.textContent = a.initial || 'ㅇ';
  av.style.setProperty('--c', a.color || COLORS[0]);
  $('#asName').textContent = a.name || '피클';
  const doing = doingTaskOf(id);
  $('#asStatus').textContent = doing ? '진행 중 · ' + doing.title : (a.status || '대기 중');
  const online = isOnline(a);
  const st = $('#asState');
  st.textContent = online ? '접속 중' : '최근 참여';
  st.className = 'at-state ' + (online ? 'on' : 'off');
  $('#asInfo').innerHTML = `
    <span>📍 ${esc(ZONE_LABEL[a.room] || '지휘실')}</span>
    <span>⚡ ${doing ? esc(short(doing.title, 20)) : '대기 중'}</span>
    <span>🗂 대기 ${waitingCountOf(id)}건</span>`;
  $('#asTitle').value = '';
  $('#asNote').value = '';
  $('#asPriority').value = '보통';
  $('#asStatusSel').value = 'todo';
  openModal('assignModal');
  setTimeout(() => $('#asTitle').focus(), 60);
}

function createTask({ title, owner, priority, note, status }) {
  const now = Date.now();
  const task = { id: uid(), title, owner: owner || '', priority, note: note || '', status: status || 'todo', createdAt: now, updatedAt: now };
  emit('task', { task });
  return task;
}

function submitAssign() {
  const target = state.agents[assignTargetId] || recallPeer(assignTargetId);
  if (!target) { closeModal('assignModal'); return; }
  const title = $('#asTitle').value.trim();
  if (!title) { toast('작업 제목을 적어 주세요'); $('#asTitle').focus(); return; }
  if (!state.agents[target.id]) {
    state.agents[target.id] = normalizeAgent({
      id: target.id, name: target.name || '피클', initial: target.initial || 'ㅇ',
      color: target.color || COLORS[0], status: '', x: ZONE_SPOT.command[0], y: ZONE_SPOT.command[1],
      room: 'command', updatedAt: 0, _seen: 0,
    });
  }
  createTask({
    title,
    owner: target.id,
    priority: $('#asPriority').value,
    note: $('#asNote').value.trim(),
    status: $('#asStatusSel').value,
  });
  closeModal('assignModal');
  toast(`🗂️ ${target.name || '피클'}에게 "${short(title, 14)}" 맡겼어요`);
  assignTargetId = null;
}

/* ══════════ 지휘실 지시 모달 ══════════ */
function openCommand() {
  const sel = $('#cmdOwner');
  sel.innerHTML = ownerOptionsHTML('');
  $('#cmdText').value = '';
  $('#cmdPriority').value = '보통';
  $('#cmdStatus').value = 'todo';
  openModal('commandModal');
  setTimeout(() => $('#cmdText').focus(), 60);
}
function submitCommand() {
  const text = $('#cmdText').value.trim();
  if (!text) { toast('지시 내용을 적어 주세요'); $('#cmdText').focus(); return; }
  const owner = $('#cmdOwner').value;
  createTask({ title: text, owner, priority: $('#cmdPriority').value, status: $('#cmdStatus').value });
  const a = state.agents[meId];
  if (a) {
    [a.x, a.y] = ZONE_SPOT.command; a.room = 'command'; a.updatedAt = Date.now();
    renderAgents(); saveState(); publishMe();
  }
  closeModal('commandModal');
  toast(owner ? `💬 ${ownerName(owner)}에게 지시를 내렸어요` : '💬 미배정 작업으로 지시를 남겼어요');
  clearBadge();
}

/* ══════════ 모달 공통 ══════════ */
function openModal(id) {
  const m = $('#' + id);
  m.hidden = false;
  document.body.classList.add('modal-open');
  if (id === 'dbModal') fillDbModal();
}
function closeModal(id) {
  const m = $('#' + id);
  m.hidden = true;
  if (!$$('.overlay').some((o) => !o.hidden)) document.body.classList.remove('modal-open');
}

/* ══════════ DB 설정 ══════════ */
function fillDbModal() {
  $$('.mode-card').forEach((c) => c.classList.toggle('sel', c.dataset.mode === mode));
  const radio = $(`.mode-card[data-mode="${mode}"] input`);
  if (radio) radio.checked = true;
  $('#fbBox').classList.toggle('off', mode !== 'firebase');
  $('#fbUrl').value = fbUrl;
  $('#roomInput').value = room;
  $('#inviteUrl').value = inviteLink();
  $('#fbResult').textContent = '';
  renderRelayList();
}
async function testFirebase() {
  const url = ($('#fbUrl').value || '').trim().replace(/\/+$/, '');
  const out = $('#fbResult');
  if (!url) { out.textContent = 'URL을 입력해 주세요'; out.className = 'fb-result bad'; return; }
  out.textContent = '확인 중…'; out.className = 'fb-result';
  try {
    const res = await fetch(`${url}/pickleOffice/${encodeURIComponent(room)}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    out.textContent = data ? '연결 OK · 기존 데이터 있음' : '연결 OK · 빈 DB';
    out.className = 'fb-result ok';
  } catch (e) {
    out.textContent = '실패: ' + (e.message || e);
    out.className = 'fb-result bad';
  }
}
function applyDbSettings() {
  const nextMode = $('.mode-card.sel')?.dataset.mode || 'nostr';
  const nextUrl = ($('#fbUrl').value || '').trim().replace(/\/+$/, '');
  const nextRoom = cleanRoom($('#roomInput').value) || DEFAULT_ROOM;
  localStorage.setItem('po.mode', nextMode);
  localStorage.setItem('po.fbUrl', nextUrl);
  localStorage.setItem('po.room', nextRoom);
  mode = nextMode;
  fbUrl = nextUrl;
  closeModal('dbModal');
  if (nextRoom !== room) {
    location.href = `${location.pathname}?room=${encodeURIComponent(nextRoom)}`;
    return;
  }
  startSync();
  toast(nextMode === 'firebase' ? 'Firebase 모드로 전환했어요' : 'Nostr 릴레이로 연결했어요');
}

function inviteLink() {
  const base = location.origin && location.origin !== 'null'
    ? location.origin + location.pathname
    : 'https://dayunchoi.github.io/myproject/';
  return `${base}?room=${encodeURIComponent(room)}`;
}

async function copyInvite() {
  const url = inviteLink();
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 초대 링크를 복사했어요');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('🔗 초대 링크를 복사했어요'); } catch (e) { toast('링크: ' + url); }
    ta.remove();
  }
}

/* ══════════ 테마 ══════════ */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('po.theme', t); } catch (_) {}
  const icon = $('#themeIcon');
  if (icon) icon.textContent = t === 'dark' ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#161412' : '#f6f1ea';
}

/* ══════════ 이벤트 연결 ══════════ */
function wire() {
  $$('.tabrow').forEach((row) => row.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) switchTab(b.dataset.tab);
  }));

  $('#profileBtn').addEventListener('click', openProfile);
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
  $('#copyLinkBtn').addEventListener('click', copyInvite);
  $('#dbBtn').addEventListener('click', () => openModal('dbModal'));

  /* 지도 */
  const stage = $('#mapStage');
  $$('.room-tag', stage).forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    enterZone(btn.dataset.enter);
  }));
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.agent') || e.target.closest('.room-tag')) return;
    const r = stage.getBoundingClientRect();
    moveMe(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  $('#commandBtn').addEventListener('click', openCommand);
  $('#cmdSubmit').addEventListener('click', submitCommand);

  /* 회의실 */
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    const a = state.agents[meId];
    emit('chat', { msg: { id: uid(), agentId: meId, name: a.name, initial: a.initial, color: a.color, text, ts: Date.now() } });
    if (a.room !== 'meeting') {
      [a.x, a.y] = ZONE_SPOT.meeting; a.room = 'meeting'; a.updatedAt = Date.now(); publishMe();
    }
    input.value = '';
    const list = $('#chatList');
    list.scrollTop = list.scrollHeight;
  });

  let agendaTimer = null;
  $('#agendaInput').addEventListener('input', (e) => {
    const text = e.target.value;
    renderAgendaSaved(false);
    clearTimeout(agendaTimer);
    agendaTimer = setTimeout(() => {
      push({ id: uid(), ts: Date.now(), by: meId, type: 'agenda', agenda: { text, updatedAt: Date.now() } });
      renderAgendaSaved(true);
      setTimeout(() => renderAgendaSaved(false), 1600);
    }, 420);
  });

  $('#todoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#todoInput');
    const text = input.value.trim();
    if (!text) return;
    emit('todo', { todo: { id: uid(), text, done: false, updatedAt: Date.now() } });
    input.value = '';
  });
  $('#todoList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-todo]');
    if (!li) return;
    const cur = state.todos[li.dataset.todo];
    if (!cur) return;
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'toggle') emit('todo', { todo: { ...cur, done: !cur.done, updatedAt: Date.now() } });
    if (act === 'del') emit('todo', { todo: { ...cur, deleted: true, updatedAt: Date.now() } });
  });

  /* 작업실 */
  const taskForm = $('#taskForm');
  $('#newTaskBtn').addEventListener('click', () => {
    taskForm.hidden = !taskForm.hidden;
    if (!taskForm.hidden) { fillOwnerSelect($('#taskOwner')); $('#taskTitle').focus(); }
  });
  $('#taskOwner').addEventListener('focus', () => fillOwnerSelect($('#taskOwner')));
  $('#cancelTaskBtn').addEventListener('click', () => { taskForm.hidden = true; taskForm.reset(); });
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#taskTitle').value.trim();
    if (!title) return;
    const owner = $('#taskOwner').value;
    createTask({ title, owner, priority: $('#taskPriority').value, note: $('#taskNote').value.trim() });
    taskForm.reset();
    taskForm.hidden = true;
    toast(owner ? `🗂️ ${ownerName(owner)}에게 지시했어요` : '🗂️ 미배정 작업으로 추가했어요');
  });

  $('#kanban').addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-task]');
    if (!card) return;
    const cur = state.tasks[card.dataset.task];
    if (!cur) return;
    const move = e.target.closest('button[data-move]');
    const del = e.target.closest('button[data-del]');
    const take = e.target.closest('button[data-take]');
    if (move) emit('task', { task: { ...cur, status: move.dataset.move, updatedAt: Date.now() } });
    else if (del) emit('task', { task: { ...cur, deleted: true, updatedAt: Date.now() } });
    else if (take) {
      emit('task', { task: { ...cur, owner: meId, updatedAt: Date.now() } });
      toast(`🙋 "${short(cur.title, 16)}" 내가 맡았어요`);
    }
  });
  $('#kanban').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-owner]');
    if (!sel) return;
    const card = sel.closest('.card[data-task]');
    const cur = card && state.tasks[card.dataset.task];
    if (!cur) return;
    const owner = sel.value || '';
    if (owner === (cur.owner || '')) return;
    if (owner && !state.agents[owner]) {
      const p = recallPeer(owner);
      if (p) {
        state.agents[owner] = normalizeAgent({
          id: p.id, name: p.name, initial: p.initial, color: p.color, status: p.status || '',
          x: ZONE_SPOT.command[0], y: ZONE_SPOT.command[1], room: 'command', updatedAt: 0, _seen: 0,
        });
      }
    }
    emit('task', { task: { ...cur, owner, updatedAt: Date.now() } });
    toast(owner ? `🤝 담당을 ${ownerName(owner)}에게 넘겼어요` : '🤝 담당을 미배정으로 바꿨어요');
  });

  let dragId = null;
  $('#kanban').addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card[data-task]');
    if (!card) return;
    dragId = card.dataset.task;
    card.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
  });
  $('#kanban').addEventListener('dragend', () => {
    dragId = null;
    $$('.card.dragging').forEach((c) => c.classList.remove('dragging'));
    $$('.col.drag-over').forEach((c) => c.classList.remove('drag-over'));
  });
  $$('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = dragId || e.dataTransfer.getData('text/plain');
      const cur = state.tasks[id];
      if (!cur) return;
      const status = col.dataset.status;
      if (cur.status !== status) emit('task', { task: { ...cur, status, updatedAt: Date.now() } });
    });
  });

  /* 비서현황 */
  $('#agentGrid').addEventListener('click', (e) => {
    const assign = e.target.closest('[data-assign]');
    if (assign) { openAssign(assign.dataset.assign); return; }
    if (e.target.closest('[data-edit-me]')) openProfile();
  });

  /* AI한도 */
  $('#limitGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('#lmSave');
    if (!btn) return;
    const dailyRaw = $('#lmDaily').value;
    const weeklyRaw = $('#lmWeekly').value;
    const daily = dailyRaw === '' ? null : clamp(Number(dailyRaw), 0, 100);
    const weekly = weeklyRaw === '' ? null : clamp(Number(weeklyRaw), 0, 100);
    const limit = {
      id: meId, daily, weekly, state: $('#lmState').value, note: $('#lmNote').value.trim(),
      updatedAt: Date.now(), by: meId,
    };
    emit('limit', { limit });
    renderLimits(true);
    const ok = $('#lmSaved');
    if (ok) { ok.textContent = '저장됨 ✓'; setTimeout(() => { ok.textContent = ''; }, 1800); }
    toast('📊 내 AI 한도를 기록했어요');
  });

  /* 메모 */
  $('#memoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#memoTitle').value.trim();
    if (!title) return;
    const a = state.agents[meId];
    const now = Date.now();
    emit('memo', {
      memo: {
        id: uid(), title, body: $('#memoBody').value.trim(),
        author: a.name, initial: a.initial, color: a.color,
        pinned: false, createdAt: now, updatedAt: now,
      },
    });
    $('#memoForm').reset();
    toast('📝 메모를 남겼어요');
  });
  $('#memoGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-memo]');
    if (!card) return;
    const m = state.memos[card.dataset.memo];
    if (!m) return;
    if (e.target.closest('[data-pin]')) emit('memo', { memo: { ...m, pinned: !m.pinned, updatedAt: Date.now() } });
    else if (e.target.closest('[data-mdel]')) emit('memo', { memo: { ...m, deleted: true, updatedAt: Date.now() } });
  });

  /* 루틴 */
  $$('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    const form = $('#routineForm');
    form.hidden = false;
    $('#rtKind').value = btn.dataset.add;
    $('#rtWhen').value = '';
    $('#rtTitle').value = '';
    $('#rtNote').value = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('#rtWhen').focus(), 220);
  }));
  $('#routineCancel').addEventListener('click', () => { $('#routineForm').hidden = true; });
  $('#routineCancel2').addEventListener('click', () => { $('#routineForm').hidden = true; });
  $('#routineForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = $('#rtKind').value;
    const when = $('#rtWhen').value.trim();
    const title = $('#rtTitle').value.trim();
    if (!when || !title) { toast('시간과 루틴 이름을 적어 주세요'); return; }
    const now = Date.now();
    emit('routine', {
      routine: {
        id: uid(), kind, when, title, note: $('#rtNote').value.trim(),
        enabled: true, order: 1000 + Object.keys(state.routines).length,
        updatedAt: now, by: meId,
      },
    });
    $('#routineForm').hidden = true;
    toast('🔁 루틴을 추가했어요');
  });
  ['#dailyList', '#periodicList'].forEach((sel) => {
    $(sel).addEventListener('click', (e) => {
      const li = e.target.closest('[data-rid]');
      if (!li) return;
      const r = state.routines[li.dataset.rid];
      if (!r) return;
      if (e.target.closest('[data-rtoggle]')) {
        emit('routine', { routine: { ...r, enabled: r.enabled === false, updatedAt: Date.now() } });
      } else if (e.target.closest('[data-rdel]')) {
        emit('routine', { routine: { ...r, deleted: true, updatedAt: Date.now() } });
      }
    });
  });

  /* 모달 */
  $('#pfSave').addEventListener('click', saveProfile);
  ['pfName', 'pfInitial', 'pfStatus'].forEach((id) => $('#' + id).addEventListener('input', updatePreview));
  $('#pfColors').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-color]');
    if (b) { selectColor(b.dataset.color); updatePreview(); }
  });
  $('#asSubmit').addEventListener('click', submitAssign);
  $('#asTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAssign(); } });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.overlay').forEach((o) => { if (!o.hidden) closeModal(o.id); });
  });

  $$('.mode-card').forEach((card) => card.addEventListener('click', () => {
    $$('.mode-card').forEach((c) => c.classList.toggle('sel', c === card));
    $('#fbBox').classList.toggle('off', card.dataset.mode !== 'firebase');
  }));
  $('#fbTest').addEventListener('click', testFirebase);
  $('#dbApply').addEventListener('click', applyDbSettings);
  $('#copyInvite2').addEventListener('click', copyInvite);

  document.addEventListener('visibilitychange', () => { if (!document.hidden) publishMe(); });
  window.addEventListener('beforeunload', rememberPeers);
}

function renderAgendaSaved(on) {
  const el = $('#agendaSaved');
  if (!el) return;
  el.textContent = on ? '저장됨' : '입력 중…';
  el.classList.toggle('on', !!on);
}

/* ══════════ 시작 ══════════ */
applyTheme(localStorage.getItem('po.theme') === 'dark' ? 'dark' : 'light');
loadState();
wire();
renderClock();
renderAll();
switchTab('map');
startSync();

setInterval(renderClock, 1000);
setInterval(() => { renderAgents(); renderHeader(); rememberPeers(); }, 20000);

// 내 피클 생존 신호
setInterval(() => {
  if (document.hidden) return;
  const a = state.agents[meId];
  if (!a) return;
  const clean = { ...a };
  delete clean._seen;
  emit('agent', { agent: clean });
}, 28000);

// 다른 탭 상태 동기화
window.addEventListener('storage', (e) => {
  if (e.key !== stateKey || !e.newValue) return;
  try {
    const next = purgeDemoData(JSON.parse(e.newValue));
    if (next.agents) {
      state = { ...emptyState(), ...next };
      ensureMe();
      for (const a of Object.values(state.agents)) normalizeAgent(a);
      scheduleRender();
    }
  } catch (_) {}
});

// 검증용
window.__po = {
  get state() { return state; },
  get bus() { return bus; },
  get mode() { return mode; },
  get peers() { return knownPeers; },
  room,
  meId,
};
