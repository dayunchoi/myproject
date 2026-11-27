/* ═══════════════════════════════════════════════════════════
   와플 & 피클 합동 비서실 — app
   실시간 동기화: Nostr 공용 릴레이(기본) / Firebase RTDB(선택)
   + BroadcastChannel + localStorage
   ═══════════════════════════════════════════════════════════ */
import { NostrBus } from './nostr.js?v=4';

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

const stateKey = 'po.state.' + room;
const seen = new Set();
let state = emptyState();
let mode = localStorage.getItem('po.mode') === 'firebase' ? 'firebase' : 'nostr';
let fbUrl = (localStorage.getItem('po.fbUrl') || '').trim().replace(/\/+$/, '');

function emptyState() {
  return { agents: {}, tasks: {}, todos: {}, messages: [], agenda: { text: '', updatedAt: 0 } };
}

const DEMO_AGENTS = [
  { id: 'demo-mochi', name: '모찌', initial: 'ㅁ', color: '#93c5fd', status: '회의 자료 정리 중', x: 57, y: 26.5, room: 'work' },
  { id: 'demo-tofu', name: '두부', initial: 'ㄷ', color: '#86efac', status: '문서 검토 중', x: 69, y: 26.5, room: 'work' },
  { id: 'demo-sogeum', name: '소금', initial: 'ㅅ', color: '#fcd34d', status: '대회의실에서 대기 중', x: 30.5, y: 48, room: 'meeting' },
  { id: 'demo-latte', name: '라떼', initial: 'ㄹ', color: '#f9a8d4', status: '라운지에서 충전 중', x: 67, y: 80, room: 'lounge' },
];

/* ────────── 초기 데이터 ────────── */
function seed() {
  const t = Date.now();
  DEMO_AGENTS.forEach((a, i) => {
    state.agents[a.id] = { ...a, demo: true, updatedAt: t - 60000 + i, _seen: t };
  });

  state.agenda = { text: '이번 주 합동 비서실 운영 점검 · 각 피클 진행 상황 공유', updatedAt: t - 50000 };

  const tasks = [
    { title: '주말 잠실 데이트 코스 후보 정리', owner: 'demo-mochi', priority: '보통', note: '전시 · 카페 3곳', status: 'todo' },
    { title: '12월 카드 결제 예산표 갱신', owner: meId, priority: '높음', note: '리볼빙 포함해서', status: 'todo' },
    { title: '나고야 숙소 취소 규정 확인', owner: meId, priority: '높음', note: '도미인·케이한 비교', status: 'doing' },
    { title: '발레 주 5회 일정 캘린더 정리', owner: 'demo-tofu', priority: '보통', note: '평일 저녁 위주', status: 'doing' },
    { title: '회의실 안건 초안 공유', owner: 'demo-sogeum', priority: '낮음', note: '지난주 메모 정리 완료', status: 'done' },
  ];
  tasks.forEach((task, i) => {
    const id = 'seed-task-' + i;
    state.tasks[id] = { id, ...task, createdAt: t - 100000 + i * 1000, updatedAt: t - 80000 + i * 1000 };
  });

  [['합동 비서실 방 이름 정하기', true], ['각 피클 담당 업무 나누기', false], ['주간 진행 상황 공유 시간 정하기', false]].forEach(([text, done], i) => {
    const id = 'seed-todo-' + i;
    state.todos[id] = { id, text, done, updatedAt: t - 70000 + i * 1000 };
  });

  const msgs = [
    { agentId: 'demo-sogeum', name: '소금', initial: 'ㅅ', color: '#fcd34d', text: '대회의실 준비 다 됐어요. 안건부터 볼까요?', ts: t - 3600000 },
    { agentId: 'demo-mochi', name: '모찌', initial: 'ㅁ', color: '#93c5fd', text: '주말 나들이 후보 3개 정리해서 올려뒀습니다 🙌', ts: t - 3300000 },
    { agentId: meId, name: '와플', initial: 'ㅇ', color: '#c4b5fd', text: '좋아요. 예산표랑 같이 보면서 정리해요!', ts: t - 3000000 },
  ];
  state.messages = msgs.map((m, i) => ({ ...m, id: 'seed-msg-' + i }));
}

/* ────────── 내 피클 ────────── */
function ensureMe() {
  const t = Date.now();
  let a = state.agents[meId];
  if (!a) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('po.profile') || '{}'); } catch (_) { return {}; } })();
    a = {
      id: meId,
      name: saved.name || '와플',
      initial: saved.initial || 'ㅇ',
      color: saved.color || '#c4b5fd',
      status: saved.status || '오피스 맵 정리 중',
      x: 44, y: 32, room: 'work',
      updatedAt: t, _seen: t,
    };
    state.agents[meId] = a;
  }
  a._seen = Date.now();
  return a;
}

function loadState() {
  let loaded = null;
  try {
    const raw = localStorage.getItem(stateKey);
    if (raw) loaded = JSON.parse(raw);
  } catch (_) {}
  if (loaded && loaded.agents) {
    state = { ...emptyState(), ...loaded };
    state.agenda = state.agenda || { text: '', updatedAt: 0 };
    state.messages = state.messages || [];
  } else {
    state = emptyState();
    seed();
  }
  // 예시 요원은 항상 정해진 자리에 (로컬 전용)
  DEMO_AGENTS.forEach((d) => {
    const cur = state.agents[d.id];
    if (cur) {
      cur.x = d.x; cur.y = d.y; cur.room = d.room;
      cur.name = cur.name || d.name;
      cur.color = cur.color || d.color;
      cur.initial = cur.initial || d.initial;
      cur.demo = true;
    }
  });

  ensureMe();
  // 저장된 내 캐릭터는 항상 내 프로필을 따른다
  const savedProfile = (() => { try { return JSON.parse(localStorage.getItem('po.profile') || '{}'); } catch (_) { return {}; } })();
  if (savedProfile.name) Object.assign(state.agents[meId], savedProfile);
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
const isDemo = (a) => !!a.demo;
const isOnline = (a) => {
  if (!a) return false;
  if (a.id === meId) return true;
  if (isDemo(a)) return true;
  return Date.now() - (a._seen || 0) < 120000;
};
const onlineAgents = () => Object.values(state.agents).filter(isOnline);
const realOnline = () => onlineAgents().filter((a) => !isDemo(a));
const inMeeting = () => Object.values(state.agents).filter((a) => a.room === 'meeting');
const ownerOf = (id) => state.agents[id];

function saveState() {
  try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch (_) {}
}

function toast(text) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2400);
}

/* ────────── op 적용 / 발행 ────────── */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
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
    const cur = state.agents[a.id];
    if (!cur || (a.updatedAt || 0) >= (cur.updatedAt || 0)) {
      const prevSeen = cur?._seen || 0;
      state.agents[a.id] = { ...(cur || {}), ...a, _seen: Math.max(prevSeen, seenTs) };
      changed = true;
    } else if (remote) {
      cur._seen = Math.max(cur._seen || 0, seenTs);
    }
  } else if (op.type === 'agenda' && op.agenda) {
    if ((op.agenda.updatedAt || 0) >= (state.agenda.updatedAt || 0)) {
      state.agenda = { ...op.agenda };
      changed = true;
    }
  } else if (op.type === 'chat' && op.msg) {
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
    const cur = state.tasks[op.task.id];
    if (!cur || (op.task.updatedAt || 0) >= (cur.updatedAt || 0)) {
      state.tasks[op.task.id] = { ...op.task };
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
let lastHello = 0;
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
      bc = new BroadcastChannel('pickleoffice-' + room);
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
  state = {
    agents: doc.agents || {},
    tasks: doc.tasks || {},
    todos: doc.todos || {},
    agenda: doc.agenda || { text: '', updatedAt: 0 },
    messages: Array.isArray(doc.messages) ? doc.messages : [],
  };
  ensureMe();
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
      bc = new BroadcastChannel('pickleoffice-' + room);
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

const short = (s, n = 14) => {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};
function doingTaskOf(a) {
  return Object.values(state.tasks)
    .filter((t) => t.owner === a.id && t.status === 'doing' && !t.deleted)
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0];
}
function bubbleFull(a) {
  const doing = doingTaskOf(a);
  if (doing) return '⚡ ' + doing.title;
  return a.status || '';
}
function bubbleFor(a) {
  return short(bubbleFull(a), 14);
}

function renderAgents() {
  const layer = $('#agentLayer');
  const alive = new Set();
  // 10분 넘게 소식 없는 요원은 정리 (예시 요원·내 피클 제외)
  const staleBefore = Date.now() - 10 * 60 * 1000;
  for (const [id, a] of Object.entries(state.agents)) {
    if (id !== meId && !isDemo(a) && (a._seen || 0) < staleBefore) {
      delete state.agents[id];
      saveState();
    }
  }
  const list = Object.values(state.agents).sort((a, b) => (a.id === meId ? 1 : b.id === meId ? -1 : 0));
  for (const a of list) {
    // 지금 이 사무실에 있는 요원만 보여줌 (오래된 접속 기록은 숨김)
    if (!isOnline(a) && a.id !== meId) continue;
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
        <div class="tag"><b></b><span class="nm"></span><span class="demo-tag">예시</span></div>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (a.id === meId) openProfile();
        else toast(`${a.name} · ${bubbleFor(a) || '대기 중'}`);
      });
      layer.appendChild(el);
      agentEls.set(a.id, el);
    }
    el.style.left = a.x + '%';
    el.style.top = a.y + '%';
    el.style.setProperty('--c', a.color || '#c4b5fd');
    el.classList.toggle('me', a.id === meId);
    el.classList.toggle('demo', isDemo(a));
    el.classList.toggle('offline', !isOnline(a));
    const bubble = el.querySelector('.bubble');
    const text = bubbleFor(a);
    const bt = el.querySelector('.bt');
    if (bt.textContent !== text) bt.textContent = text;
    bubble.classList.toggle('show', !!text && isOnline(a));
    bubble.title = bubbleFull(a);
    const b = el.querySelector('.tag b');
    if (b.textContent !== (a.initial || 'ㅇ')) b.textContent = a.initial || 'ㅇ';
    const nm = el.querySelector('.nm');
    if (nm.textContent !== a.name) nm.textContent = a.name;
    el.querySelector('.demo-tag').style.display = isDemo(a) ? '' : 'none';
    el.title = `${a.name}${isDemo(a) ? ' (예시 요원)' : ''} · ${bubbleFull(a) || '대기 중'}`;
  }
  for (const [id, el] of agentEls) {
    if (!alive.has(id)) { el.remove(); agentEls.delete(id); }
  }
}

function renderFacepile() {
  const box = $('#facepile');
  const online = realOnline().sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const demoCount = onlineAgents().filter(isDemo).length;
  box.innerHTML = online.slice(0, 4)
    .map((a) => `<span class="fp" style="--c:${esc(a.color)}" title="${esc(a.name)}">${esc(a.initial)}</span>`)
    .join('') + (online.length > 4 ? `<span class="fp more">+${online.length - 4}</span>` : '');
  $('#onlineCount').textContent = String(realOnline().length || 1);
  $('#onlineBadge').title = demoCount ? `접속 중인 피클 ${realOnline().length}명 · 예시 요원 ${demoCount}명` : '접속 중인 피클';
  $('#meAvatar').textContent = state.agents[meId]?.initial || 'ㅇ';
  $('#meAvatar').style.setProperty('--accent', state.agents[meId]?.color || '#c4b5fd');
  $('#chatAvatar').textContent = state.agents[meId]?.initial || 'ㅇ';
  $('#chatAvatar').style.setProperty('--accent', state.agents[meId]?.color || '#c4b5fd');
  $('#roomTag').textContent = 'room: ' + room;
}

/* ────────── 렌더: 회의실 ────────── */
let lastChatCount = 0;
function renderMeeting() {
  const participants = inMeeting();
  $('#meetingCount').textContent = String(participants.length);
  $('#partCount').textContent = `${participants.length}명`;
  const pSig = participants.map((a) => a.id + a.name + a.initial).join('|');
  const pBox = $('#participantList');
  if (pBox.dataset.sig !== pSig) {
    pBox.dataset.sig = pSig;
    pBox.innerHTML = participants.length
      ? participants.map((a) => `<span class="chip ${a.id === meId ? 'me' : ''}" style="--c:${esc(a.color)}"><i>${esc(a.initial)}</i>${esc(a.name)}${isDemo(a) ? '<span class="away">예시</span>' : ''}</span>`).join('')
      : '<span class="chip"><i style="--c:#475569">·</i>아직 아무도 없어요</span>';
  }

  const agendaInput = $('#agendaInput');
  if (document.activeElement !== agendaInput) agendaInput.value = state.agenda.text || '';

  const list = $('#chatList');
  const inner = $('#chatInner');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  const msgs = state.messages.slice(-200);
  $('#chatEmpty').hidden = msgs.length > 0;
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
      </li>`).join('') || '<li style="color:#5b6680;font-size:10.5px;padding:8px 6px">결정사항을 추가해 보세요</li>';
  }
}

/* ────────── 렌더: 작업실 ────────── */
function renderKanban() {
  const tasks = Object.values(state.tasks).filter((t) => !t.deleted);
  const sig = tasks.map((t) => `${t.id}:${t.status}:${t.updatedAt}:${t.title}:${t.note || ''}:${t.owner}:${t.priority}`).join('|');
  const board = $('#kanban');
  if (board.dataset.sig === sig) return;
  board.dataset.sig = sig;
  for (const status of ['todo', 'doing', 'done']) {
    const items = tasks.filter((t) => t.status === status).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const box = $('#col-' + status);
    $(`[data-count="${status}"]`).textContent = String(items.length);
    const emptyText = { todo: ['🗂️', '대기 중인 작업이 없어요'], doing: ['⚡', '진행 중인 작업이 없어요'], done: ['🎉', '완료된 작업이 없어요'] }[status];
    box.innerHTML = items.length
      ? items.map((t) => cardHTML(t)).join('')
      : `<div class="empty-col"><span class="e">${emptyText[0]}</span>${emptyText[1]}</div>`;
  }
}

function cardHTML(t) {
  const owner = ownerOf(t.owner);
  const pCls = t.priority === '높음' ? 'high' : t.priority === '낮음' ? 'low' : 'mid';
  const moves = [];
  if (t.status === 'todo') moves.push(['doing', '▶', '시작']);
  if (t.status === 'doing') {
    moves.push(['todo', '◀', '대기로']);
    moves.push(['done', '✓', '완료']);
  }
  if (t.status === 'done') moves.push(['doing', '↺', '되돌리기']);
  return `
    <article class="card ${t.status === 'done' ? 'done' : ''}" draggable="true" data-task="${esc(t.id)}">
      <div class="ch">
        <span class="prio ${pCls}">${esc(t.priority)}</span>
        <span class="who"><i style="--c:${esc(owner?.color || '#64748b')}">${esc(owner?.initial || '·')}</i>${esc(owner?.name || '미지정')}</span>
      </div>
      <div class="ct">${esc(t.title)}</div>
      ${t.note ? `<div class="cn">${esc(t.note)}</div>` : ''}
      <div class="cf">
        <span class="sp"></span>
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
    <li><div class="hud-agent">
      <i style="--c:${esc(a.color)}">${esc(a.initial)}</i>
      <span class="hn">${esc(a.name)}</span>
      ${isDemo(a) ? '<span class="demo">예시</span>' : '<span class="dot"></span>'}
      <span class="hs">${esc(short(bubbleFull(a), 12) || '대기 중')}</span>
    </div></li>`).join('');

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
    meeting: [28.5, 42],
    work: [57, 26.5],
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
  // 방으로 들어가면 내 피클도 그 공간으로 이동
  const a = state.agents[meId];
  if (a && (tab === 'meeting' || tab === 'work') && a.room !== tab) {
    const [x, y] = tab === 'meeting' ? [28.5, 42] : [57, 26.5];
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
  document.body.classList.remove('modal-open');
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

  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    const a = state.agents[meId];
    emit('chat', { msg: { id: uid(), agentId: meId, name: a.name, initial: a.initial, color: a.color, text, ts: Date.now() } });
    if (a.room !== 'meeting') { a.room = 'meeting'; a.x = 28.5; a.y = 42; a.updatedAt = Date.now(); publishMe(); }
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
  $('#cancelTaskBtn').addEventListener('click', () => { taskForm.hidden = true; taskForm.reset(); });
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#taskTitle').value.trim();
    if (!title) return;
    const task = {
      id: uid(),
      title,
      owner: $('#taskOwner').value,
      priority: $('#taskPriority').value,
      note: $('#taskNote').value.trim(),
      status: 'todo',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    emit('task', { task });
    taskForm.reset();
    taskForm.hidden = true;
    toast('🗂️ 새 작업을 지시했어요');
  });

  $('#kanban').addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-task]');
    if (!card) return;
    const id = card.dataset.task;
    const cur = state.tasks[id];
    if (!cur) return;
    const move = e.target.closest('button[data-move]');
    const del = e.target.closest('button[data-del]');
    if (move) emit('task', { task: { ...cur, status: move.dataset.move, updatedAt: Date.now() } });
    else if (del) emit('task', { task: { ...cur, deleted: true, updatedAt: Date.now() } });
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
}

function fillOwnerSelect() {
  const sel = $('#taskOwner');
  const agents = Object.values(state.agents).sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  sel.innerHTML = agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.id === meId ? ' (나)' : isDemo(a) ? ' · 예시' : ''}</option>`).join('');
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
setInterval(() => { renderAgents(); renderFacepile(); renderHud(); }, 20000);

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
  room,
  meId,
};

// 다른 탭/기기에서 온 op 는 BroadcastChannel 로, 릴레이는 NostrBus 로
window.addEventListener('storage', (e) => {
  if (e.key !== stateKey || !e.newValue) return;
  try {
    const next = JSON.parse(e.newValue);
    if (next.agents) {
      state = { ...emptyState(), ...next };
      ensureMe();
      scheduleRender();
    }
  } catch (_) {}
});
