/* ═══════════════════════════════════════════════════════════
   와플 & 피클 합동 비서실 — app
   예시(더미) 요원 없이, 실제로 접속한 피클끼리 일을 나누는 협업 사무실
   실시간 동기화: Nostr 공용 릴레이(기본) / Firebase RTDB(선택)
   + BroadcastChannel + localStorage
   ═══════════════════════════════════════════════════════════ */
import { NostrBus } from './nostr.js?v=9';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14));

const DEFAULT_ROOM = 'dayun-office';
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.primal.net'];
const COLORS = ['#c4b5fd', '#93c5fd', '#86efac', '#fcd34d', '#f9a8d4', '#fdba74', '#a5b4fc', '#e2e8f0'];
const ZONES = {
  meeting: { left: 3.2, top: 6.2, right: 32.6, bottom: 72.2 },
  work: { left: 35.5, top: 8.5, right: 84, bottom: 50 },
  lounge: { left: 48.5, top: 55.5, right: 96, bottom: 88.5 },
};
const STATUS_LABEL = { todo: '대기', doing: '진행 중', done: '완료' };
const LEGACY_ID = /^(demo-|seed-|fake-)/;

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

/* 상태 저장 키 (예시 데이터가 섞여 있던 이전 상태와 분리) */
const stateKey = 'po.state.2.' + room;
const peersKey = 'po.peers.' + room;
const seen = new Set();
let state = emptyState();
let mode = localStorage.getItem('po.mode') === 'firebase' ? 'firebase' : 'nostr';
let fbUrl = (localStorage.getItem('po.fbUrl') || '').trim().replace(/\/+$/, '');

function emptyState() {
  return { agents: {}, tasks: {}, todos: {}, messages: [], agenda: { text: '', updatedAt: 0 } };
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
      color: a.color || '#c4b5fd',
      status: a.status || '',
      lastSeen: a._seen || Date.now(),
    });
  }
  knownPeers = [...map.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 12);
  try { localStorage.setItem(peersKey, JSON.stringify(knownPeers)); } catch (_) {}
}

function recallPeer(id) {
  return knownPeers.find((p) => p.id === id) || null;
}

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
      color: saved.color || '#c4b5fd',
      status: saved.status || '',
      x: 44, y: 32, room: 'work',
      updatedAt: t,
    };
    state.agents[meId] = a;
  }
  a._seen = t;
  return a;
}

/* 예전 예시(더미) 데이터 청소 — 남아 있어도 절대 화면에 나오지 않게 */
function purgeDemoData(s) {
  if (!s || typeof s !== 'object') return s;
  s.agents = s.agents && typeof s.agents === 'object' ? s.agents : {};
  s.tasks = s.tasks && typeof s.tasks === 'object' ? s.tasks : {};
  s.todos = s.todos && typeof s.todos === 'object' ? s.todos : {};
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
  const savedProfile = readProfile();
  if (savedProfile.name) Object.assign(state.agents[meId], savedProfile);
  rememberPeers();
}

/* ────────── 유틸 ────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const timeHM = (ts) => {
  const d = new Date(ts || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const short = (s, n = 14) => {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};
/* 접속 판정: 나 → 항상, 남 → 최근 75초 안에 신호 */
const isOnline = (a) => {
  if (!a) return false;
  if (a.id === meId) return true;
  return Date.now() - (a._seen || 0) < 75000;
};
const onlineAgents = () => Object.values(state.agents).filter(isOnline);
const inMeeting = () => Object.values(state.agents).filter((a) => isOnline(a) && a.room === 'meeting');
const ownerOf = (id) => state.agents[id] || recallPeer(id) || null;
const ownerName = (id) => ownerOf(id)?.name || '미지정';

function saveState() {
  try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch (_) {}
}

function toast(text) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2600);
}

/* ────────── 작업실 탭 알림 배지 ────────── */
let badgeCount = 0;
function paintBadge() {
  const el = $('#workBadge');
  if (!el) return;
  el.textContent = badgeCount > 9 ? '9+' : String(badgeCount);
  el.hidden = badgeCount === 0;
}
function bumpBadge() {
  badgeCount += 1;
  paintBadge();
}
function clearBadge() {
  if (!badgeCount) return;
  badgeCount = 0;
  paintBadge();
}

/* ────────── op 적용 / 발행 ────────── */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

/* 내 작업이 배정·변경되면 알림 */
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
  // 릴레이에서 과거 이력을 받아올 때 오래된 요원이 '접속 중'으로 보이지 않도록
  const seenTs = remote && createdAtSec ? Math.min(createdAtSec * 1000, now) : now;
  let changed = false;

  if (op.type === 'agent' && op.agent) {
    const a = op.agent;
    if (!a.id || LEGACY_ID.test(a.id)) return false;
    const cur = state.agents[a.id];
    const isNewPeer = !cur && a.id !== meId;
    if (!cur || (a.updatedAt || 0) >= (cur.updatedAt || 0)) {
      const prevSeen = cur?._seen || 0;
      state.agents[a.id] = { ...(cur || {}), ...a, _seen: Math.max(prevSeen, seenTs) };
      changed = true;
    } else if (remote) {
      cur._seen = Math.max(cur._seen || 0, seenTs);
    }
    if (isNewPeer && op.by !== meId) toast(`👋 ${a.name || '피클'} 피클이 들어왔어요`);
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
  const op = { id: uid(), ts: Date.now(), by: meId, type, ...payload };
  push(op);
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

/* ────────── 동기화: Nostr ────────── */
let bus = null;
let bc = null;
let fb = { es: null, timer: null, lastRev: 0, active: false };

function setConn(kind, text, detail) {
  const el = $('#connBadge');
  el.classList.remove('warn', 'off');
  if (kind === 'warn') el.classList.add('warn');
  if (kind === 'off') el.classList.add('off');
  $('#connText').textContent = text;
  $('#connDetail').textContent = detail || '';
  renderRelayList();
}

function startNostr() {
  stopFirebase();
  if (bus) bus.close();
  if (!bc) {
    try {
      bc = new BroadcastChannel('pickleoffice2-' + room);
      bc.onmessage = (e) => applyOp(e.data, true);
    } catch (_) { bc = null; }
  }
  setConn('warn', '연결 중…', 'Nostr');
  bus = new NostrBus({
    relays: RELAYS,
    room,
    onEvent: (op, ev) => applyOp(op, true, ev?.created_at),
    onStatus: ({ ready, total, connecting }) => {
      if (ready > 0) setConn('ok', '실시간 연결', `Nostr ${ready}/${total}`);
      else if (connecting > 0) setConn('warn', '연결 중…', `Nostr 0/${total}`);
      else setConn('off', '로컬 모드', '릴레이 연결 실패');
      renderRelayList();
    },
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

/* ────────── 동기화: Firebase RTDB ────────── */
function fbPath() {
  return `${fbUrl}/pickleOffice/${encodeURIComponent(room)}.json`;
}
function scheduleFbPush() {
  if (mode !== 'firebase' || !fbUrl) return;
  clearTimeout(fb.timer);
  fb.timer = setTimeout(fbPush, 500);
}
async function fbPush() {
  if (!fbUrl) return;
  const doc = {
    rev: Date.now(),
    agents: state.agents,
    tasks: state.tasks,
    todos: state.todos,
    agenda: state.agenda,
    messages: state.messages.slice(-150),
  };
  fb.lastRev = doc.rev;
  try {
    const res = await fetch(fbPath(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    console.warn('[firebase] push failed', e);
  }
}
function adoptRemote(doc) {
  if (!doc || typeof doc !== 'object' || !doc.agents) return;
  if ((doc.rev || 0) <= fb.lastRev) return;
  fb.lastRev = doc.rev || 0;
  state = purgeDemoData({
    agents: doc.agents || {},
    tasks: doc.tasks || {},
    todos: doc.todos || {},
    agenda: doc.agenda || { text: '', updatedAt: 0 },
    messages: Array.isArray(doc.messages) ? doc.messages : [],
  });
  ensureMe();
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
      bc = new BroadcastChannel('pickleoffice2-' + room);
      bc.onmessage = (e) => applyOp(e.data, true);
    } catch (_) { bc = null; }
  }
  stopFirebase();
  fb.active = true;
  setConn('warn', 'Firebase 연결 중…', 'RTDB');
  try {
    const res = await fetch(fbPath(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data) adoptRemote(data);
  } catch (e) {
    setConn('off', 'Firebase 오류', String(e.message || e));
    toast('Firebase 연결 실패 — URL과 규칙을 확인해 주세요');
    return;
  }
  try {
    const es = new EventSource(fbPath());
    fb.es = es;
    es.onopen = () => setConn('ok', '실시간 연결', 'Firebase RTDB');
    es.onerror = () => setConn('warn', 'Firebase 재연결 중…', 'RTDB');
    es.addEventListener('put', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed && parsed.path === '/') adoptRemote(parsed.data);
      } catch (_) {}
    });
  } catch (e) {
    setConn('off', 'Firebase 오류', 'EventSource 실패');
  }
  setTimeout(() => { publishMe(); saveState(); }, 600);
}

function startSync() {
  if (mode === 'firebase' && fbUrl) startFirebase();
  else startNostr();
}

/* ────────── 렌더: 캐릭터 ────────── */
const agentEls = new Map();

function doingTaskOf(a) {
  return Object.values(state.tasks)
    .filter((t) => t.owner === a.id && t.status === 'doing' && !t.deleted)
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0];
}
function waitingCountOf(a) {
  return Object.values(state.tasks)
    .filter((t) => t.owner === a.id && t.status === 'todo' && !t.deleted).length;
}
function bubbleFull(a) {
  const doing = doingTaskOf(a);
  if (doing) return '⚡ ' + doing.title;
  if (a.status) return a.status;
  const wait = waitingCountOf(a);
  if (wait) return `🗂 대기 ${wait}건`;
  return '';
}
function bubbleFor(a) {
  return short(bubbleFull(a), 14);
}

function renderAgents() {
  const layer = $('#agentLayer');
  const alive = new Set();
  // 10분 넘게 소식 없는 피클은 지도에서 정리
  const staleBefore = Date.now() - 10 * 60 * 1000;
  for (const [id, a] of Object.entries(state.agents)) {
    if (id !== meId && (a._seen || 0) < staleBefore) {
      delete state.agents[id];
      saveState();
    }
  }
  const list = Object.values(state.agents)
    .filter((a) => a.id === meId || isOnline(a))
    .sort((a, b) => (a.id === meId ? 1 : b.id === meId ? -1 : 0));

  for (const a of list) {
    alive.add(a.id);
    let el = agentEls.get(a.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'agent';
      el.dataset.agent = a.id;
      el.innerHTML = `
        <div class="bubble"><span class="bt"></span></div>
        <div class="stem"></div>
        <div class="body"><span class="eyes"><i></i><i></i></span><span class="mouth"></span></div>
        <div class="shadow"></div>
        <div class="tag"><b></b><span class="nm"></span></div>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (a.id === meId) openProfile();
        else openAssign(a.id);
      });
      layer.appendChild(el);
      agentEls.set(a.id, el);
    }
    el.style.left = a.x + '%';
    el.style.top = a.y + '%';
    el.style.setProperty('--c', a.color || '#c4b5fd');
    el.classList.toggle('me', a.id === meId);
    el.classList.toggle('offline', !isOnline(a));
    const bubble = el.querySelector('.bubble');
    const text = bubbleFor(a);
    const bt = el.querySelector('.bt');
    if (bt.textContent !== text) bt.textContent = text;
    bubble.classList.toggle('show', !!text && isOnline(a));
    bubble.classList.toggle('busy', !!doingTaskOf(a));
    bubble.title = bubbleFull(a);
    const b = el.querySelector('.tag b');
    if (b.textContent !== (a.initial || 'ㅇ')) b.textContent = a.initial || 'ㅇ';
    const nm = el.querySelector('.nm');
    if (nm.textContent !== a.name) nm.textContent = a.name;
    el.title = `${a.name} · ${bubbleFull(a) || '대기 중'}${a.id === meId ? ' (나)' : ' · 클릭해서 일 맡기기'}`;
  }
  for (const [id, el] of agentEls) {
    if (!alive.has(id)) { el.remove(); agentEls.delete(id); }
  }
}

function renderFacepile() {
  const box = $('#facepile');
  const online = Object.values(state.agents).filter(isOnline)
    .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  box.innerHTML = online.slice(0, 4)
    .map((a) => `<span class="fp" style="--c:${esc(a.color)}" title="${esc(a.name)}">${esc(a.initial)}</span>`)
    .join('') + (online.length > 4 ? `<span class="fp more">+${online.length - 4}</span>` : '');
  $('#onlineCount').textContent = String(online.length);
  $('#onlineBadge').title = `접속 중인 피클 ${online.length}명`;
  $('#meAvatar').textContent = state.agents[meId]?.initial || 'ㅇ';
  $('#meAvatar').style.setProperty('--accent', state.agents[meId]?.color || '#c4b5fd');
  $('#chatAvatar').textContent = state.agents[meId]?.initial || 'ㅇ';
  $('#chatAvatar').style.setProperty('--accent', state.agents[meId]?.color || '#c4b5fd');
  $('#roomTag').textContent = 'room: ' + room;
}

/* ────────── 담당 피클 목록 (실제 참여자 + 최근 참여 기억) ────────── */
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
    .filter((p) => !listed.has(p.id) && p.id !== meId)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .slice(0, 6)
    .forEach((p) => rows.push({ id: p.id, label: `${p.name || '피클'} · 최근 참여`, state: 'off' }));
  return rows;
}

function ownerOptionsHTML(selected, withBlank = true) {
  const rows = assignableList();
  let html = withBlank ? `<option value=""${!selected ? ' selected' : ''}>미배정</option>` : '';
  html += rows.map((r) => `<option value="${esc(r.id)}"${r.id === selected ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
  if (selected && !rows.some((r) => r.id === selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(ownerOf(selected)?.name || '알 수 없는 피클')}</option>`;
  }
  return html;
}

function fillOwnerSelect() {
  const sel = $('#taskOwner');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = ownerOptionsHTML(cur);
}

/* ────────── 렌더: 회의실 ────────── */
function renderMeeting() {
  const participants = inMeeting();
  $('#meetingCount').textContent = String(participants.length);
  $('#partCount').textContent = `${participants.length}명`;
  const pSig = participants.map((a) => a.id + a.name + a.initial).join('|');
  const pBox = $('#participantList');
  if (pBox.dataset.sig !== pSig) {
    pBox.dataset.sig = pSig;
    pBox.innerHTML = participants.length
      ? participants.map((a) => `<span class="chip ${a.id === meId ? 'me' : ''}" style="--c:${esc(a.color)}"><i>${esc(a.initial)}</i>${esc(a.name)}${a.id === meId ? '<span class="away">나</span>' : ''}</span>`).join('')
      : '<span class="chip"><i style="--c:#475569">·</i>아직 아무도 없어요</span>';
  }

  const agendaInput = $('#agendaInput');
  if (document.activeElement !== agendaInput) agendaInput.value = state.agenda.text || '';

  const list = $('#chatList');
  const inner = $('#chatInner');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  const msgs = state.messages.slice(-200);
  $('#chatHint').hidden = msgs.length > 0;
  inner.hidden = msgs.length === 0;
  if (msgs.length && inner.dataset.sig !== msgs[msgs.length - 1].id) {
    inner.innerHTML = msgs.map((m) => `
      <div class="msg ${m.agentId === meId ? 'mine' : ''}">
        <div class="mav" style="--c:${esc(m.color || '#c4b5fd')}">${esc(m.initial || 'ㅇ')}</div>
        <div class="mb">
          <div class="mh"><span class="mn">${esc(m.name)}</span><span class="mt">${timeHM(m.ts)}</span></div>
          <div class="mx">${esc(m.text)}</div>
        </div>
      </div>`).join('');
    inner.dataset.sig = msgs[msgs.length - 1].id;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }

  const todos = Object.values(state.todos).filter((t) => !t.deleted).sort((a, b) => (a.done === b.done ? a.updatedAt - b.updatedAt : a.done ? 1 : -1));
  const done = todos.filter((t) => t.done).length;
  $('#todoProgress').style.width = todos.length ? `${(done / todos.length) * 100}%` : '0%';
  $('#todoProgressText').textContent = `${done} / ${todos.length} 완료`;
  const tSig = todos.map((t) => `${t.id}:${t.done}:${t.text}`).join('|');
  const tBox = $('#todoList');
  if (tBox.dataset.sig !== tSig) {
    tBox.dataset.sig = tSig;
    tBox.innerHTML = todos.map((t) => `
      <li class="${t.done ? 'done' : ''}" data-todo="${esc(t.id)}">
        <button class="cb" data-act="toggle">✓</button>
        <span class="tt">${esc(t.text)}</span>
        <button class="del" data-act="del" title="삭제">✕</button>
      </li>`).join('') || '<li class="todo-empty">아직 결정사항이 없어요</li>';
  }
}

/* ────────── 렌더: 작업실 ────────── */
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

function cardHTML(t) {
  const owner = ownerOf(t.owner);
  const mine = t.owner === meId;
  const pCls = t.priority === '높음' ? 'high' : t.priority === '낮음' ? 'low' : 'mid';
  const moves = [];
  if (t.status === 'todo') moves.push(['doing', '▶', '시작']);
  if (t.status === 'doing') {
    moves.push(['todo', '◀', '대기로']);
    moves.push(['done', '✓', '완료']);
  }
  if (t.status === 'done') moves.push(['doing', '↺', '되돌리기']);
  return `
    <article class="card ${t.status === 'done' ? 'done' : ''} ${mine ? 'mine' : ''}" draggable="true" data-task="${esc(t.id)}">
      <div class="ch">
        <span class="prio ${pCls}">${esc(t.priority)}</span>
        <span class="who"><i style="--c:${esc(owner?.color || '#64748b')}">${esc(owner?.initial || '·')}</i>${esc(owner?.name || '미지정')}</span>
        ${mine ? '<span class="my-tag">내 작업</span>' : ''}
      </div>
      <div class="ct">${esc(t.title)}</div>
      ${t.note ? `<div class="cn">${esc(t.note)}</div>` : ''}
      <div class="cf">
        <select class="opick" data-owner title="담당 피클 변경">${ownerOptionsHTML(t.owner)}</select>
        <span class="sp"></span>
        ${mine ? '' : '<button class="mv take" data-take="1" title="내가 맡기">내가 맡기</button>'}
        ${moves.map(([s, icon, label]) => `<button class="mv" data-move="${s}" title="${label}">${icon}</button>`).join('')}
        <button class="mv del" data-del="1" title="삭제">🗑</button>
      </div>
    </article>`;
}

/* ────────── 전체 렌더 ────────── */
function renderAll() {
  renderAgents();
  renderFacepile();
  renderMeeting();
  renderKanban();
  renderHud();
}

function renderHud() {
  const list = $('#hudAgents');
  if (!list) return;
  const agents = Object.values(state.agents)
    .filter(isOnline)
    .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  $('#hudAgentCount').textContent = String(agents.length);
  list.innerHTML = agents.map((a) => `
    <li><button class="hud-agent" type="button" data-agent="${esc(a.id)}" title="${esc(a.id === meId ? '내 프로필' : a.name + '에게 일 맡기기')}">
      <i style="--c:${esc(a.color)}">${esc(a.initial)}</i>
      <span class="hn">${esc(a.name)}</span>
      ${a.id === meId ? '<span class="me-chip">나</span>' : '<span class="dot"></span>'}
      <span class="hs">${esc(short(bubbleFull(a), 12) || '대기 중')}</span>
    </button></li>`).join('')
    + (agents.length <= 1
      ? '<li class="hud-empty">아직 다른 피클이 들어오지 않았어요.<br>초대 링크를 공유해 보세요!</li>'
      : '');

  const doing = Object.values(state.tasks)
    .filter((t) => t.status === 'doing' && !t.deleted)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 4);
  $('#hudDoingCount').textContent = String(doing.length);
  $('#hudTasks').innerHTML = doing.length
    ? doing.map((t) => {
        const o = ownerOf(t.owner);
        return `<li><div class="hud-task"><span class="bar" style="background:${esc(o?.color || '#94a3b8')}"></span>
          <div><b>${esc(t.title)}</b><span class="hwho">${esc(o?.name || '미지정')}</span></div></div></li>`;
      }).join('')
    : '<li class="empty">진행 중인 작업이 없어요</li>';
  const agenda = $('#hudAgenda');
  if (agenda) agenda.textContent = state.agenda.text || '—';
}
let savedTimer = null;
function renderAgendaSaved(on) {
  const el = $('#agendaSaved');
  if (!el) return;
  el.textContent = on ? '저장됨' : '입력 중…';
  el.classList.toggle('on', !!on);
}

/* ────────── 내 캐릭터 이동 ────────── */
function zoneAt(x, y) {
  for (const [name, z] of Object.entries(ZONES)) {
    if (x >= z.left && x <= z.right && y >= z.top && y <= z.bottom) return name;
  }
  return null;
}

function moveMe(x, y) {
  const a = state.agents[meId];
  if (!a) return;
  a.x = clamp(x, 3, 97);
  a.y = clamp(y, 6, 95);
  a.room = zoneAt(a.x, a.y) || a.room;
  a.updatedAt = Date.now();
  renderAgents();
  saveState();
  publishMeThrottled();
}

function enterZone(zone) {
  const spot = {
    meeting: [17, 58],
    work: [44, 32],
    lounge: [60, 70],
  }[zone];
  moveMe(spot[0], spot[1]);
  if (zone === 'meeting') {
    switchTab('meeting');
    toast('🏛️ 대회의실로 이동했어요');
  } else if (zone === 'work') {
    switchTab('work');
    toast('💻 작업실로 이동했어요');
  } else {
    toast('☕ 라운지 — 잠깐 쉬어가는 중');
  }
}

function initMap() {
  const stage = $('#mapStage');
  const setHot = (zone) => {
    $$('.zone', stage).forEach((z) => z.classList.toggle('hot', z.dataset.zone === zone));
  };
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setHot(zoneAt(x, y));
  });
  stage.addEventListener('pointerleave', () => setHot(null));
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.zone-label') || e.target.closest('.agent')) return;
    const r = stage.getBoundingClientRect();
    moveMe(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  $$('.zone-label', stage).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      enterZone(btn.dataset.enter);
    });
  });
}

/* ────────── 탭 ────────── */
function switchTab(tab) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
  requestAnimationFrame(moveGlider);
  if (tab === 'meeting') $('#chatList').scrollTop = $('#chatList').scrollHeight;
  if (tab === 'work') clearBadge();
  // 방으로 들어가면 내 피클도 그 공간으로 이동
  const a = state.agents[meId];
  if (a && (tab === 'meeting' || tab === 'work') && a.room !== tab) {
    const [x, y] = tab === 'meeting' ? [17, 58] : [44, 32];
    a.x = x; a.y = y; a.room = tab; a.updatedAt = Date.now();
    renderAgents();
    saveState();
    publishMe();
  }
}
function moveGlider() {
  const active = $('#tabs button.active');
  const glider = $('#tabGlider');
  if (!active || !glider) return;
  glider.style.width = active.offsetWidth + 'px';
  glider.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

/* ────────── 프로필 모달 ────────── */
let pfColor = '#c4b5fd';
function openProfile() {
  const a = state.agents[meId];
  if (!a) return;
  $('#pfName').value = a.name || '';
  $('#pfInitial').value = a.initial || '';
  $('#pfStatus').value = a.status || '';
  pfColor = a.color || '#c4b5fd';
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
  const initial = $('#pfInitial').value.trim() || 'ㅇ';
  const status = $('#pfStatus').value.trim() || '상태 메시지';
  $('#pvName').textContent = name;
  $('#pvInitial').textContent = initial;
  $('#pvBubble').textContent = status.length > 18 ? status.slice(0, 18) + '…' : status;
  $('#pvAgent').style.setProperty('--c', pfColor);
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

/* ────────── 일 맡기기 모달 (지도·명단에서 피클 클릭) ────────── */
let assignTargetId = null;

function openAssign(id) {
  const a = state.agents[id] || recallPeer(id);
  if (!a || id === meId) return;
  assignTargetId = id;
  const av = $('#asAvatar');
  av.textContent = a.initial || 'ㅇ';
  av.style.setProperty('--c', a.color || '#c4b5fd');
  $('#asName').textContent = a.name || '피클';
  $('#asStatus').textContent = bubbleFull(a) || '대기 중';
  const online = isOnline(a);
  const st = $('#asState');
  st.textContent = online ? '접속 중' : '최근 참여';
  st.className = 'at-state ' + (online ? 'on' : 'off');
  $('#asTitle').value = '';
  $('#asNote').value = '';
  $('#asPriority').value = '보통';
  $('#asStatusSel').value = 'todo';
  openModal('assignModal');
  setTimeout(() => $('#asTitle').focus(), 60);
}

function submitAssign() {
  const target = state.agents[assignTargetId] || recallPeer(assignTargetId);
  if (!target) { closeModal('assignModal'); return; }
  const title = $('#asTitle').value.trim();
  if (!title) {
    toast('작업 제목을 적어 주세요');
    $('#asTitle').focus();
    return;
  }
  if (!state.agents[target.id]) {
    // 최근 참여 기억만 있는 피클: 담당 표시가 되도록 명단에 올려 둔다
    state.agents[target.id] = {
      id: target.id,
      name: target.name || '피클',
      initial: target.initial || 'ㅇ',
      color: target.color || '#c4b5fd',
      status: '',
      x: 44, y: 32, room: 'work',
      updatedAt: 0, _seen: 0,
    };
  }
  const now = Date.now();
  emit('task', {
    task: {
      id: uid(),
      title,
      owner: target.id,
      priority: $('#asPriority').value,
      note: $('#asNote').value.trim(),
      status: $('#asStatusSel').value,
      createdAt: now,
      updatedAt: now,
    },
  });
  closeModal('assignModal');
  toast(`🗂️ ${target.name || '피클'}에게 "${short(title, 14)}" 맡겼어요`);
  assignTargetId = null;
}

/* ────────── 모달 공통 ────────── */
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

/* ────────── 이벤트 연결 ────────── */
function wire() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });

  initMap();

  $('#mySeatBtn').addEventListener('click', () => { moveMe(44, 32); toast('📍 내 자리로 돌아왔어요'); });
  $('#copyLinkBtn').addEventListener('click', copyInvite);
  $('#hudInvite')?.addEventListener('click', copyInvite);

  $('#hudAgents').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-agent]');
    if (!btn) return;
    if (btn.dataset.agent === meId) openProfile();
    else openAssign(btn.dataset.agent);
  });

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    const a = state.agents[meId];
    emit('chat', { msg: { id: uid(), agentId: meId, name: a.name, initial: a.initial, color: a.color, text, ts: Date.now() } });
    if (a.room !== 'meeting') { a.room = 'meeting'; a.x = 17; a.y = 58; a.updatedAt = Date.now(); publishMe(); }
    input.value = '';
    $('#chatList').scrollTop = $('#chatList').scrollHeight;
  });

  let agendaTimer = null;
  $('#agendaInput').addEventListener('input', (e) => {
    const text = e.target.value;
    renderAgendaSaved(false);
    clearTimeout(agendaTimer);
    agendaTimer = setTimeout(() => {
      const op = { id: uid(), ts: Date.now(), by: meId, type: 'agenda', agenda: { text, updatedAt: Date.now() } };
      push(op);
      renderAgendaSaved(true);
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => renderAgendaSaved(false), 1600);
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
    const id = li.dataset.todo;
    const cur = state.todos[id];
    if (!cur) return;
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'toggle') emit('todo', { todo: { ...cur, done: !cur.done, updatedAt: Date.now() } });
    if (act === 'del') emit('todo', { todo: { ...cur, deleted: true, updatedAt: Date.now() } });
  });

  const taskForm = $('#taskForm');
  $('#newTaskBtn').addEventListener('click', () => {
    taskForm.hidden = !taskForm.hidden;
    if (!taskForm.hidden) {
      fillOwnerSelect();
      $('#taskTitle').focus();
    }
  });
  $('#taskOwner').addEventListener('focus', fillOwnerSelect);
  $('#cancelTaskBtn').addEventListener('click', () => { taskForm.hidden = true; taskForm.reset(); });
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#taskTitle').value.trim();
    if (!title) return;
    const owner = $('#taskOwner').value;
    const now = Date.now();
    const task = {
      id: uid(),
      title,
      owner,
      priority: $('#taskPriority').value,
      note: $('#taskNote').value.trim(),
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    };
    emit('task', { task });
    taskForm.reset();
    taskForm.hidden = true;
    toast(owner ? `🗂️ ${ownerName(owner)}에게 지시했어요` : '🗂️ 미배정 작업으로 추가했어요');
  });

  $('#kanban').addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-task]');
    if (!card) return;
    const id = card.dataset.task;
    const cur = state.tasks[id];
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
        state.agents[owner] = {
          id: p.id, name: p.name, initial: p.initial, color: p.color,
          status: p.status || '', x: 44, y: 32, room: 'work', updatedAt: 0, _seen: 0,
        };
      }
    }
    emit('task', { task: { ...cur, owner, updatedAt: Date.now() } });
    toast(owner ? `🤝 담당을 ${ownerName(owner)}에게 넘겼어요` : '🤝 담당을 미배정으로 바꿨어요');
  });

  // 드래그 앤 드롭
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

  $('#profileBtn').addEventListener('click', openProfile);
  ['pfName', 'pfInitial', 'pfStatus'].forEach((id) => $('#' + id).addEventListener('input', updatePreview));
  $('#pfColors').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-color]');
    if (b) { selectColor(b.dataset.color); updatePreview(); }
  });
  $('#pfSave').addEventListener('click', saveProfile);

  $('#asSubmit').addEventListener('click', submitAssign);
  $('#asTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAssign(); } });

  $('#dbBtn').addEventListener('click', () => openModal('dbModal'));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) closeModal(o.id); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.overlay').forEach((o) => { if (!o.hidden) closeModal(o.id); });
  });

  $$('.mode-card').forEach((card) => {
    card.addEventListener('click', () => {
      $$('.mode-card').forEach((c) => c.classList.toggle('sel', c === card));
      const fbBox = $('#fbBox');
      fbBox.classList.toggle('off', card.dataset.mode !== 'firebase');
    });
  });
  $('#fbTest').addEventListener('click', testFirebase);
  $('#dbApply').addEventListener('click', applyDbSettings);
  $('#copyInvite2').addEventListener('click', copyInvite);

  window.addEventListener('resize', moveGlider);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { publishMe(); }
  });
  window.addEventListener('beforeunload', rememberPeers);
}

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
    out.textContent = data ? '연결 OK · 기존 데이터 있음' : '연결 OK · 빈 DB (읽기 가능)';
    out.className = 'fb-result ok';
  } catch (e) {
    out.textContent = '실패: ' + (e.message || e) + ' (규칙/URL 확인)';
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

/* ────────── 시작 ────────── */
loadState();
wire();
renderAll();
switchTab('map');
requestAnimationFrame(() => { moveGlider(); setTimeout(moveGlider, 120); });
startSync();

// 접속 상태(온라인/오프라인) 주기적 갱신
setInterval(() => { renderAgents(); renderFacepile(); renderHud(); rememberPeers(); }, 20000);

// 내 피클 주기적 생존 신호
setInterval(() => {
  if (document.hidden) return;
  const a = state.agents[meId];
  if (!a) return;
  const clean = { ...a };
  delete clean._seen;
  emit('agent', { agent: clean });
}, 28000);

// 디버그/검증용 (페이지 자체 동작에는 영향 없음)
window.__po = {
  get state() { return state; },
  get bus() { return bus; },
  get mode() { return mode; },
  get peers() { return knownPeers; },
  room,
  meId,
};

// 다른 탭/기기에서 온 op 는 BroadcastChannel 로, 릴레이는 NostrBus 로
window.addEventListener('storage', (e) => {
  if (e.key !== stateKey || !e.newValue) return;
  try {
    const next = purgeDemoData(JSON.parse(e.newValue));
    if (next.agents) {
      state = { ...emptyState(), ...next };
      ensureMe();
      scheduleRender();
    }
  } catch (_) {}
});
