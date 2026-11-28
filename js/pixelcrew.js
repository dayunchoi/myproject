/* ═══════════════════════════════════════════════════════════
   도트 캐릭터 · 오피스 맵 걷기 엔진 (스타듀밸리풍 2등신 픽셀아트)

   · 캐릭터는 20x24 격자 SVG(shape-rendering=crispEdges)로 그립니다.
   · map 은 assets/office-pixel.webp (1402 x 1122) 이고, 좌표는 모두 % 입니다.
   · 일할 때는 4개 나무 책상 의자로 걸어가 앉고, 회의·토론 때는 원형 테이블
     의자에 앉습니다. 평소에는 라운지·복도·회의실 주변을 거닐어요.
   ═══════════════════════════════════════════════════════════ */

/* ────────── 팔레트 ────────── */
const shade = (hex, amt) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const to = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  const r = to((n >> 16) & 255), g = to((n >> 8) & 255), b = to(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

const SKIN = '#f7d3b3';
const SKIN_D = '#e2b391';
const EYE = '#33241f';
const BLUSH = '#f0a194';
const LINE = '#3c2a22'; // 실루엣 외곽선

function palette(kind, baseColor) {
  const base = baseColor || '#b3b0dd';
  switch (kind) {
    case 'waffle':
      return {
        hair: '#c9b6f0', hairD: '#a58cdb', hairL: '#e6dcfd',
        top: '#f8eedb', topD: '#e4d3b7',
        accent: '#e8b64c', accentD: '#b8842c',
        pants: '#8f7bbd', pantsD: '#75619f', shoe: '#5b4a68',
        cap: null, mark: 'waffle',
      };
    case 'claude':
      return {
        hair: '#e8825f', hairD: '#c15a3c', hairL: '#f2a98c',
        top: '#fdf4e8', topD: '#ecd7bf',
        accent: '#e2703f', accentD: '#ad4a22',
        pants: '#8a7361', pantsD: '#6d5847', shoe: '#4c372c',
        cap: null, mark: 'spark',
      };
    case 'gemini':
      return {
        hair: '#7fc4ee', hairD: '#4c9fd6', hairL: '#bfe6fb',
        top: '#eef6ff', topD: '#c9dff3',
        accent: '#f2c14e', accentD: '#3f7fbf',
        pants: '#5b7fa3', pantsD: '#476985', shoe: '#38526a',
        cap: null, mark: 'star',
      };
    case 'dayun':
      return {
        hair: '#4c3730', hairD: '#33231d', hairL: '#6d4d40',
        top: '#f8e6bb', topD: '#e0c68e',
        accent: '#e0a92a', accentD: '#a97c14',
        pants: '#c9a45c', pantsD: '#a8863f', shoe: '#6b4b3a',
        cap: 'crown', mark: 'gem',
      };
    default:
      return {
        hair: base, hairD: shade(base, -36), hairL: shade(base, 28),
        top: '#f4eee4', topD: '#d8cfbe',
        accent: shade(base, -12), accentD: shade(base, -46),
        pants: '#8b8279', pantsD: '#6f675f', shoe: '#544a42',
        cap: null, mark: 'dot',
      };
  }
}

/* ────────── 스프라이트 정의 (20 x 24 격자) ────────── */
const GRID_W = 20;
const GRID_H = 24;

/**
 * 포즈별 사각형 목록을 만듭니다.
 * pose: 'stand' | 'sit' | 'desk'
 * frame: 0 | 1  (걷기 두 프레임 / 타자 두 프레임)
 */
export function spriteRects(kind, pose = 'stand', frame = 0, baseColor) {
  const p = palette(kind, baseColor);
  const rects = [];
  const add = (x, y, w, h, c) => { if (w > 0 && h > 0) rects.push([x, y, w, h, c]); };

  /* ────────── 다리 · 발 ────────── */
  if (pose === 'stand') {
    const liftL = frame === 0 ? 1 : 0;
    const liftR = frame === 0 ? 0 : 1;
    add(7, 17, 2, 4 - liftL, p.pants);
    add(7, 21 - liftL, 2, 1, p.shoe);
    add(11, 17, 2, 4 - liftR, p.pantsD);
    add(11, 21 - liftR, 2, 1, p.shoe);
  } else if (pose === 'sit') {
    add(6, 17, 3, 2, p.pants);        // 허벅지
    add(11, 17, 3, 2, p.pantsD);
    add(6, 19, 2, 2, p.pants);        // 정강이
    add(12, 19, 2, 2, p.pantsD);
    add(5, 21, 3, 1, p.shoe);
    add(12, 21, 3, 1, p.shoe);
  } else {
    add(7, 17, 2, 3, p.pants);        // 의자에 가린 다리
    add(11, 17, 2, 3, p.pantsD);
    add(6, 20, 4, 1, p.shoe);
    add(10, 20, 4, 1, p.shoe);
  }

  /* ────────── 몸통 ────────── */
  add(7, 11, 6, 6, p.top);            // 셔츠
  add(7, 11, 6, 1, p.topD);           // 어깨선
  add(7, 16, 6, 1, p.topD);           // 밑단
  add(9, 12, 2, 4, p.topD);           // 앞여밈

  /* ────────── 팔 ────────── */
  if (pose === 'desk') {
    const a = frame === 0 ? 0 : 1;
    add(5, 12 - a, 2, 4, p.topD);     // 책상 위로 뻗은 팔
    add(5, 11 - a, 2, 1, SKIN);
    add(13, 13 - (1 - a), 2, 3, p.topD);
    add(13, 12 - (1 - a), 2, 1, SKIN);
  } else if (pose === 'sit') {
    add(5, 12, 2, 4, p.topD);
    add(13, 12, 2, 4, p.topD);
    add(5, 16, 2, 1, SKIN);
    add(13, 16, 2, 1, SKIN);
  } else {
    const swing = frame === 0 ? 0 : 1;
    add(5, 12 - swing, 2, 4, p.topD);
    add(5, 16 - swing, 2, 1, SKIN);
    add(13, 11 + swing, 2, 4, p.topD);
    add(13, 15 + swing, 2, 1, SKIN);
  }

  /* ────────── 목 ────────── */
  add(9, 10, 2, 1, SKIN_D);

  /* ────────── 머리 ────────── */
  const top = 1;
  // 실루엣 (둥근 머리) — 위로 갈수록 좁아지는 도트 곡선
  add(7, top, 6, 1, p.hair);              // 정수리
  add(6, top + 1, 8, 2, p.hair);
  add(5, top + 3, 10, 5, p.hair);         // 머리통
  add(6, top + 8, 8, 1, p.hair);          // 턱선
  add(8, top, 4, 1, p.hairL);             // 윗광
  add(6, top + 8, 8, 1, p.hairD);         // 아래 그늘

  if (pose === 'desk') {
    // 뒷모습 — 얼굴 없이 머리카락 결만
    add(9, top + 1, 1, 8, p.hairD);       // 가르마
    add(6, top + 2, 2, 2, p.hairL);
    add(12, top + 3, 2, 1, p.hairL);
    add(7, top + 7, 3, 1, p.hairD);
    add(9, top + 9, 2, 1, SKIN_D);        // 목덜미
  } else {
    // 얼굴
    add(6, top + 3, 8, 6, SKIN);
    add(7, top + 8, 6, 1, SKIN_D);        // 턱 그늘
    add(6, top + 3, 8, 2, p.hair);        // 앞머리
    add(8, top + 3, 2, 1, p.hairL);       // 앞머리 결
    add(12, top + 4, 2, 1, p.hair);       // 옆머리 (오른)
    add(6, top + 4, 1, 1, p.hair);
    add(5, top + 3, 1, 5, p.hair);        // 옆머리 라인
    add(14, top + 3, 1, 5, p.hair);
    // 눈 · 볼 · 입
    add(7, top + 6, 2, 2, EYE);
    add(11, top + 6, 2, 2, EYE);
    add(7, top + 6, 1, 1, '#ffffff');
    add(11, top + 6, 1, 1, '#ffffff');
    add(6, top + 8, 1, 1, BLUSH);
    add(13, top + 8, 1, 1, BLUSH);
    add(9, top + 8, 2, 1, shade(SKIN, -56));
  }
  // 다윤은 어깨까지 오는 긴 머리
  if (kind === 'dayun') {
    add(5, top + 3, 1, 7, p.hair);
    add(14, top + 3, 1, 7, p.hair);
    add(5, top + 9, 1, 2, p.hairD);
    add(14, top + 9, 1, 2, p.hairD);
  }

  /* ────────── 장식 ────────── */
  if (p.cap === 'crown') {
    add(6, top - 1, 8, 1, '#f6d76b');
    add(6, top - 2, 1, 1, '#f6d76b');
    add(9, top - 2, 1, 1, '#fff1ae');
    add(12, top - 2, 1, 1, '#f6d76b');
    add(6, top - 1, 1, 1, '#d99b1f');
    add(12, top - 1, 1, 1, '#d99b1f');
  }

  if (p.mark === 'star') {
    // 스카이블루 AI의 노란 별 머리핀
    add(12, top, 1, 3, p.accent);
    add(11, top + 1, 3, 1, p.accent);
  } else if (p.mark === 'waffle') {
    // 와플 격자 머리핀
    add(12, top, 1, 1, p.accent); add(14, top, 1, 1, p.accent);
    add(13, top + 1, 1, 1, p.accentD);
    add(12, top + 2, 1, 1, p.accent); add(14, top + 2, 1, 1, p.accent);
  } else if (p.mark === 'spark') {
    add(13, top, 1, 3, p.accent);
    add(12, top + 1, 3, 1, p.accent);
  }

  /* ────────── 가슴 포인트 ────────── */
  if (p.mark === 'waffle') {
    add(9, 13, 1, 1, p.accent); add(11, 13, 1, 1, p.accent);
    add(10, 14, 1, 1, p.accentD);
    add(9, 15, 1, 1, p.accentD); add(11, 15, 1, 1, p.accentD);
  } else if (p.mark === 'star') {
    add(10, 13, 1, 3, p.accent);
    add(9, 14, 3, 1, p.accent);
  } else if (p.mark === 'spark') {
    add(10, 13, 1, 2, p.accent);
    add(9, 14, 3, 1, p.accent);
  } else if (p.mark === 'gem') {
    add(10, 13, 1, 3, p.accent);
    add(9, 14, 3, 1, p.accentD);
    add(9, 13, 1, 1, p.accentD); add(11, 13, 1, 1, p.accentD);
  } else {
    add(9, 13, 3, 2, p.accent);
    add(9, 13, 1, 1, p.accentD);
  }

  return outline(rects);
}

/** 실루엣 바깥 1px 외곽선을 붙입니다 (도트가 배경에서 또렷해짐). */
function outline(rects) {
  const cells = new Set();
  for (const [x, y, w, h] of rects) {
    for (let i = 0; i < w; i += 1) for (let j = 0; j < h; j += 1) cells.add(`${x + i},${y + j}`);
  }
  const ring = new Set();
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const k = `${nx},${ny}`;
      if (!cells.has(k)) ring.add(k);
    }
  }
  const out = [...ring].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return [x, y, 1, 1, LINE];
  });
  return out.concat(rects);
}

/** 포즈(frame 포함) 하나를 SVG 문자열로 만듭니다. */
function poseSVG(kind, pose, frame, baseColor) {
  const rects = spriteRects(kind, pose, frame, baseColor);
  return rects.map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join('');
}

/**
 * 캐릭터 SVG. 걷기·타자는 두 프레임을 겹쳐 두고 CSS 로 번갈아 보여 줍니다.
 */
export function spriteSVG(kind, pose = 'stand', baseColor) {
  const animated = pose === 'stand' || pose === 'desk';
  if (!animated) {
    return `<svg class="spr-svg spr-${pose}" viewBox="0 0 ${GRID_W} ${GRID_H}" width="20" height="24" shape-rendering="crispEdges" aria-hidden="true">${poseSVG(kind, pose, 0, baseColor)}</svg>`;
  }
  return `<svg class="spr-svg spr-${pose}" viewBox="0 0 ${GRID_W} ${GRID_H}" width="20" height="24" shape-rendering="crispEdges" aria-hidden="true">
<g class="f1">${poseSVG(kind, pose, 0, baseColor)}</g><g class="f2">${poseSVG(kind, pose, 1, baseColor)}</g></svg>`;
}

/* ────────── 이름 → 캐릭터 종류 ────────── */
export function personaOf(name = '') {
  const n = String(name);
  if (/와플|waffle/i.test(n)) return 'waffle';
  if (/claude|클로드/i.test(n)) return 'claude';
  if (/gemini|제미나이/i.test(n)) return 'gemini';
  if (/다윤|dayun/i.test(n)) return 'dayun';
  return 'pickle';
}

/* ────────── 가구 좌표 (office-pixel.webp 1402x1122 기준 %) ────────── */
// 4개 나무 책상 의자 — 앉았을 때 발(아래 끝)이 놓이는 자리
export const DESKS = [
  { x: 22.0, y: 47.4, monitor: { x: 21.7, y: 35.4 } },
  { x: 44.7, y: 47.4, monitor: { x: 44.6, y: 35.4 } },
  { x: 22.0, y: 69.2, monitor: { x: 21.7, y: 57.6 } },
  { x: 44.7, y: 69.2, monitor: { x: 44.6, y: 57.6 } },
];

// 원형 회의 테이블 의자 (시계 방향)
export const TABLE_SEATS = [
  { x: 76.0, y: 48.6 },
  { x: 84.0, y: 52.4 },
  { x: 87.8, y: 60.0 },
  { x: 82.4, y: 68.4 },
  { x: 71.2, y: 68.0 },
  { x: 66.0, y: 60.0 },
  { x: 68.8, y: 52.6 },
];

// 평상시 거니는 자리 (라운지 · 복도 · 회의실 앞 · 아래쪽 마루)
export const IDLE_SPOTS = [
  { x: 78.5, y: 37.0, area: 'lounge' },  // 러그 위
  { x: 73.0, y: 42.0, area: 'lounge' },  // 러그 왼쪽
  { x: 85.0, y: 43.5, area: 'lounge' },  // 러그 오른쪽
  { x: 60.0, y: 44.0, area: 'hall' },
  { x: 57.0, y: 60.0, area: 'hall' },
  { x: 62.0, y: 76.0, area: 'meeting' },
  { x: 40.0, y: 78.0, area: 'hall' },
  { x: 30.0, y: 30.0, area: 'hall' },
  { x: 33.0, y: 52.0, area: 'hall' },
  { x: 72.0, y: 79.0, area: 'meeting' },
  { x: 12.0, y: 74.0, area: 'hall' },
  { x: 60.0, y: 35.0, area: 'hall' },
];

// 걸어 다닐 수 없는 곳 (책상 상판 · 원형 테이블 · 소파 · 책장)
const RECTS = [
  { x0: 13.0, y0: 32.8, x1: 29.6, y1: 42.4 },
  { x0: 35.8, y0: 32.8, x1: 52.0, y1: 42.4 },
  { x0: 13.0, y0: 55.2, x1: 29.6, y1: 64.8 },
  { x0: 35.8, y0: 55.2, x1: 52.0, y1: 64.8 },
  { x0: 74.4, y0: 23.4, x1: 93.0, y1: 32.8 },
  { x0: 68.0, y0: 80.0, x1: 84.0, y1: 89.5 },
  { x0: 7.5, y0: 80.0, x1: 16.5, y1: 88.0 },
];
// 원형 테이블 (타원)
const TABLE = { cx: 77.0, cy: 57.6, rx: 7.6, ry: 7.0 };
const BOUNDS = { x0: 5.5, y0: 25.5, x1: 94.5, y1: 91.5 };

function blocked(x, y) {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || y < BOUNDS.y0 || y > BOUNDS.y1) return true;
  for (const r of RECTS) {
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  }
  const dx = (x - TABLE.cx) / TABLE.rx;
  const dy = (y - TABLE.cy) / TABLE.ry;
  return dx * dx + dy * dy < 1;
}

const dist = (ax, ay, bx, by) => Math.hypot((ax - bx) * 0.8, ay - by); // 가로:세로 = 1402:1122

/** 막힌 자리(책상·테이블 위)에 있으면 가장 가까운 빈 바닥으로 옮깁니다. */
function nearestFree(x, y) {
  if (!blocked(x, y)) return { x, y };
  for (let r = 0.8; r <= 10; r += 0.8) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      const nx = x + Math.cos(a) * r;
      const ny = y + Math.sin(a) * r;
      if (!blocked(nx, ny)) return { x: nx, y: ny };
    }
  }
  return { x: 60, y: 45 };
}

const FREE_SPOTS = IDLE_SPOTS.filter((spot) => !blocked(spot.x, spot.y));
const spotAt = (i) => (FREE_SPOTS[i % FREE_SPOTS.length] || { x: 60, y: 45 });

/* ────────── 상태 문구 ────────── */
export function bubbleFor(state) {
  switch (state) {
    case 'work': return '💻 작업 처리 중';
    case 'speak': return '💬 회의실 발언 중';
    case 'debate': return '💬 토론 중';
    case 'walk': return '🚶 자리로 이동 중';
    case 'stroll': return '🚶 거니는 중';
    case 'lounge': return '☕ 라운지 휴식';
    case 'meeting': return '🏛️ 회의실 대기';
    case 'away': return '💤 자리 비움';
    default: return '✨ 대기 중';
  }
}

/* ────────── 걷기 엔진 ────────── */
export class Crew {
  constructor(layer, opts = {}) {
    this.layer = layer;
    this.opts = opts;
    this.nodes = new Map();
    this.people = new Map();
    this.motionOn = true;
    this._raf = null;
    this._last = 0;
    this._bubAt = 0;
    this._glow = new Map();
    this._measure = 0;
    this._start();
  }

  setMotion(on) {
    this.motionOn = !!on;
    this.layer?.classList.toggle('crew-off', !on);
  }

  _plan(p) {
    if (p.doingTitle) {
      const desk = DESKS[p.desk ?? 0];
      return { x: desk.x, y: desk.y, pose: 'desk', state: 'work' };
    }
    if (p.debating) {
      const seat = TABLE_SEATS[p.seat ?? 0];
      return { x: seat.x, y: seat.y, pose: 'sit', state: 'debate' };
    }
    if (p.speak) {
      const seat = TABLE_SEATS[p.seat ?? 0];
      return { x: seat.x, y: seat.y, pose: 'sit', state: 'speak' };
    }
    if (p.meeting) {
      const seat = TABLE_SEATS[p.seat ?? 0];
      return { x: seat.x, y: seat.y, pose: 'sit', state: 'meeting' };
    }
    return null;
  }

  sync(list) {
    const seen = new Set();
    list.forEach((p, i) => {
      seen.add(p.id);
      let person = this.people.get(p.id);
      if (!person) {
        const spot = typeof p.x === 'number' && typeof p.y === 'number'
          ? { x: p.x, y: p.y }
          : spotAt(i);
        person = {
          x: spot.x, y: spot.y, tx: spot.x, ty: spot.y,
          facing: 1, state: 'idle', pose: 'stand',
          pause: 0, stuck: 0, restUntil: 0, wanderAt: 0,
          home: { x: spot.x, y: spot.y },
        };
        this.people.set(p.id, person);
      }
      person.meta = p;
      if (typeof p.x === 'number' && typeof p.y === 'number'
        && dist(person.home.x, person.home.y, p.x, p.y) > 3) {
        person.home = { x: p.x, y: p.y };
        if (!p.doingTitle && !p.debating && !p.meeting && !p.mine) {
          person.tx = p.x; person.ty = p.y;
        }
      }
      this._ensureNode(p, person);
    });
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) { node.el.remove(); this.nodes.delete(id); }
    }
    for (const id of [...this.people.keys()]) if (!seen.has(id)) this.people.delete(id);
    this._paintGlow(list);
    this._layout();
  }

  _ensureNode(p, person) {
    let node = this.nodes.get(p.id);
    const kind = personaOf(p.name);
    if (!node) {
      const el = document.createElement('div');
      el.className = 'agent';
      el.dataset.agent = p.id;
      el.innerHTML = `
        <div class="bub" aria-live="polite"></div>
        <div class="spr"></div>
        <div class="plate"><i></i><span></span></div>
        <span class="me-mark" aria-hidden="true">나</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.opts.onPick?.(p.id);
      });
      this.layer.appendChild(el);
      node = {
        el, kind: '', baseColor: '', pose: '',
        sprBox: el.querySelector('.spr'), bub: el.querySelector('.bub'),
        plate: el.querySelector('.plate span'), dot: el.querySelector('.plate i'),
      };
      this.nodes.set(p.id, node);
      node.el.style.left = person.x.toFixed(2) + '%';
      node.el.style.top = person.y.toFixed(2) + '%';
    }
    node.el.classList.toggle('me', !!p.mine);
    node.el.classList.toggle('offline', !!p.offline);
    if (node.kind !== kind || node.baseColor !== p.color) {
      node.kind = kind;
      node.baseColor = p.color;
      node.pose = '';
    }
    const nameText = p.mine ? `${p.name} (나)` : p.name;
    if (node.plate.textContent !== nameText) node.plate.textContent = nameText;
    node.dot.style.background = p.color || '#b3b0dd';
    node.el.style.setProperty('--c', p.color || '#b3b0dd');
    node.el.title = p.title || p.name;
  }

  _setPose(node, pose) {
    if (node.pose === pose) return;
    node.pose = pose;
    node.sprBox.innerHTML = spriteSVG(node.kind, pose, node.baseColor);
  }

  _paintGlow(list) {
    const busy = new Map();
    for (const p of list) if (p.doingTitle && typeof p.desk === 'number') busy.set(p.desk, true);
    DESKS.forEach((desk, i) => {
      let g = this._glow.get(i);
      if (!g) {
        g = document.createElement('div');
        g.className = 'desk-glow';
        g.style.left = desk.monitor.x + '%';
        g.style.top = desk.monitor.y + '%';
        this.layer.appendChild(g);
        this._glow.set(i, g);
      }
      g.classList.toggle('on', busy.has(i));
    });
  }

  _layout() {
    const W = this.layer.clientWidth || 700;
    const H = this.layer.clientHeight || 560;
    const scale = Math.max(0.72, Math.min(1.75, W / 430));
    if (Math.abs(scale - (this._scale || 0)) > 0.01) {
      this._scale = scale;
      this.layer.style.setProperty('--spr', scale.toFixed(3));
    }
    const sprH = 24 * scale * 1.42;
    const boxes = [];
    const now = Date.now();
    const reBub = now - this._bubAt > 240;
    if (reBub) this._bubAt = now;

    for (const [id, person] of this.people) {
      const node = this.nodes.get(id);
      if (!node || !person.meta) continue;
      const { x, y } = person;
      node.el.style.left = x.toFixed(2) + '%';
      node.el.style.top = y.toFixed(2) + '%';
      node.el.style.zIndex = String(10 + Math.round(y));
      node.el.classList.toggle('walking', person.state === 'walk');
      node.el.classList.toggle('sat', person.pose !== 'stand');
      node.el.dataset.state = person.state;
      const text = bubbleFor(person.state);
      if (node.bub.dataset.t !== text) {
        node.bub.dataset.t = text;
        node.bub.textContent = text;
      }
      if (reBub) {
        boxes.push({
          node,
          cx: (x / 100) * W,
          top: (y / 100) * H - sprH - 24,
          w: Math.min(160, 46 + text.length * 7.2) * Math.max(0.82, scale),
          h: 22,
        });
      }
    }

    if (reBub) {
      boxes.sort((a, b) => a.top - b.top);
      const placed = [];
      for (const box of boxes) {
        let lift = 0;
        const free = () => !placed.some((q) =>
          Math.abs(q.cx - box.cx) < (q.w + box.w) / 2 - 6
          && Math.abs((q.top + q.h / 2) - (box.top - lift + box.h / 2)) < box.h + 2);
        let guard = 0;
        while (!free() && guard < 4) { lift += box.h + 3; guard += 1; }
        box.node.el.style.setProperty('--lift', lift.toFixed(1) + 'px');
        placed.push({ ...box, top: box.top - lift });
      }
    }
  }

  _step(dt) {
    const now = Date.now();
    for (const [id, person] of this.people) {
      const p = person.meta;
      if (!p) continue;
      const node = this.nodes.get(id);
      if (blocked(person.x, person.y)) {
        const free = nearestFree(person.x, person.y);
        person.x = free.x; person.y = free.y;
      }
      const plan = p.offline ? null : this._plan(p);

      if (plan) {
        person.tx = plan.x; person.ty = plan.y;
        person.restUntil = 0;
      } else if (!person.restUntil) {
        person.restUntil = now + 2200 + Math.random() * 4200;
      }

      const dx = person.tx - person.x;
      const dy = person.ty - person.y;
      const d = Math.hypot(dx * 0.86, dy);
      const arrived = d < 0.8;

      if (!arrived) {
        const speed = plan ? 11 : 6.5;
        const ux = dx / (d || 1), uy = dy / (d || 1);
        const stepLen = Math.min(speed * dt, d);
        let nx = person.x + ux * stepLen;
        let ny = person.y + uy * stepLen;
        if (blocked(nx, ny)) {
          let moved = false;
          for (const ang of [0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.9, -1.9]) {
            const c = Math.cos(ang), s = Math.sin(ang);
            const rx = ux * c - uy * s, ry = ux * s + uy * c;
            const tx2 = person.x + rx * stepLen, ty2 = person.y + ry * stepLen;
            if (!blocked(tx2, ty2)) { nx = tx2; ny = ty2; moved = true; break; }
          }
          if (!moved) { nx = person.x; ny = person.y; person.stuck += dt; }
        }
        if (Math.abs(nx - person.x) > 0.002) person.facing = nx > person.x ? 1 : -1;
        person.x = nx; person.y = ny;
        if (node) {
          node.el.style.left = person.x.toFixed(2) + '%';
          node.el.style.top = person.y.toFixed(2) + '%';
          node.el.style.zIndex = String(10 + Math.round(person.y));
          node.el.style.setProperty('--flip', person.facing < 0 ? '-1' : '1');
        }
        person.state = plan ? 'walk' : 'stroll';
        if (node) this._setPose(node, 'stand');
        if (person.stuck > 1.6) {
          person.stuck = 0;
          const spot = FREE_SPOTS[Math.floor(Math.random() * FREE_SPOTS.length)] || { x: 60, y: 45 };
          person.tx = spot.x; person.ty = spot.y;
        }
      } else {
        person.stuck = 0;
        if (plan) {
          person.state = plan.state;
          if (node) this._setPose(node, plan.pose);
          person.restUntil = 0;
          if (person.arrivePublish) {
            person.arrivePublish = false;
            this.opts.onArrive?.(id, person.x, person.y);
          }
        } else {
          if (node) this._setPose(node, 'stand');
          if (person.arrivePublish) {
            person.arrivePublish = false;
            this.opts.onArrive?.(id, person.x, person.y);
          }
          const spot = IDLE_SPOTS.find((s) => dist(s.x, s.y, person.x, person.y) < 3.2);
          person.state = p.offline ? 'away'
            : spot?.area === 'lounge' ? 'lounge'
              : spot?.area === 'meeting' ? 'meeting' : 'idle';
          if (now > person.restUntil) {
            const next = FREE_SPOTS[Math.floor(Math.random() * FREE_SPOTS.length)] || { x: 60, y: 45 };
            person.restUntil = 0;
            if (dist(next.x, next.y, person.x, person.y) > 7) { person.tx = next.x; person.ty = next.y; }
            else person.restUntil = now + 2400;
          }
        }
      }
    }
  }

  _start() {
    const loop = (t) => {
      const dt = Math.min(0.05, (t - (this._last || t)) / 1000);
      this._last = t;
      if (this.motionOn) this._step(dt);
      if (t - this._measure > 600) { this._measure = t; this._layout(); }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** 내 캐릭터를 그 자리로 걸어가게 합니다. 도착하면 onArrive 로 알립니다. */
  walkTo(id, x, y) {
    const person = this.people.get(id);
    if (!person) return false;
    person.tx = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, x));
    person.ty = Math.max(BOUNDS.y0, Math.min(BOUNDS.y1, y));
    person.restUntil = 0;
    person.arrivePublish = true;
    return true;
  }

  posOf(id) {
    const person = this.people.get(id);
    return person ? { x: person.x, y: person.y } : null;
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.nodes.forEach((n) => n.el.remove());
    this.nodes.clear();
    this.people.clear();
  }
}
