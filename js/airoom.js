/* ═══════════════════════════════════════════════════════════
   AI 단톡방 연결 클라이언트 (Cloudflare Worker: ai-room-worker)
   · 키는 이 브라우저(localStorage)에만 보관합니다.
   · 주소·링크·코드 어디에도 키를 넣지 않습니다.
   ═══════════════════════════════════════════════════════════ */

export const AI_DEFAULT_URL = 'https://ai-room-worker.dayunchoi.workers.dev';
export const AI_DEFAULT_ROOM = '29bd3191-bb71-4378-9898-8fe2457491f5';
const STORE_KEY = 'po.airoom.1';

/** 저장된 연결 설정 읽기 (없으면 기본 주소·방으로 비어 있는 상태) */
export function loadAiConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_) { saved = {}; }
  return {
    url: (saved.url || AI_DEFAULT_URL).replace(/\/+$/, ''),
    roomId: saved.roomId || AI_DEFAULT_ROOM,
    key: saved.key || '',
  };
}

export function saveAiConfig({ url, roomId, key }) {
  const config = {
    url: (url || AI_DEFAULT_URL).trim().replace(/\/+$/, ''),
    roomId: (roomId || AI_DEFAULT_ROOM).trim(),
    key: (key || '').trim(),
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch (_) {}
  return config;
}

export function clearAiConfig() {
  try { localStorage.removeItem(STORE_KEY); } catch (_) {}
}

const isAdminKey = (key) => !!key && !key.startsWith('pk_ai_');

export class AiRoom {
  constructor({ url, roomId, key }) {
    this.url = (url || AI_DEFAULT_URL).replace(/\/+$/, '');
    this.roomId = roomId || AI_DEFAULT_ROOM;
    this.key = key || '';
    this.isAdmin = isAdminKey(this.key);
    this.since = 0;
    this.messages = [];
    this.members = [];
    this.status = 'idle'; // idle | connecting | online | error
    this.lastError = '';
    this._timer = null;
    this._busy = false;
    this.onUpdate = null;
    this.onStatus = null;
  }

  get connected() { return this.status === 'online'; }
  get roomUrl() { return `${this.url}/rooms/${this.roomId}`; }
  get openApiUrl() { return `${this.url}/openapi.json`; }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    // 방 주인 키는 관리자 API 로, 초대 키는 AI API 로 보냅니다.
    if (this.isAdmin) {
      h.Authorization = `Bearer ${this.key}`;
      h['X-Admin-Key'] = this.key;
    } else {
      h.Authorization = `Bearer ${this.key}`;
    }
    return h;
  }

  setStatus(status, error = '') {
    this.status = status;
    this.lastError = error;
    if (this.onStatus) this.onStatus(this);
  }

  async request(path, options = {}) {
    const res = await fetch(`${this.url}${path}`, {
      method: options.method || 'GET',
      headers: this.headers(),
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const error = new Error((data && data.message) || `HTTP ${res.status}`);
      error.status = res.status;
      error.code = data && data.error;
      throw error;
    }
    return data;
  }

  /** 연결 확인 + 멤버 + 첫 글 읽기 */
  async connect() {
    if (!this.key) throw new Error('키가 없습니다');
    this.setStatus('connecting');
    try {
      const members = await this.request(`/rooms/${this.roomId}/members`);
      this.members = (members && members.members) || [];
      if (members && members.room) this.roomName = members.room.name;
      await this.pull();
      this.setStatus('online');
      return this;
    } catch (err) {
      this.setStatus('error', err.message || '연결 실패');
      throw err;
    }
  }

  /** since 이후 새 글만 받아 옵니다. */
  async pull() {
    const path = `/rooms/${this.roomId}/messages?since=${this.since || 0}&limit=80`;
    const data = await this.request(path);
    const incoming = (data && data.messages) || [];
    if (incoming.length) {
      const seen = new Set(this.messages.map((m) => m.id));
      for (const message of incoming) {
        if (!seen.has(message.id)) this.messages.push(message);
      }
      this.messages.sort((a, b) => a.id - b.id);
      if (this.messages.length > 300) this.messages = this.messages.slice(-300);
    }
    if (data && typeof data.next_since === 'number') this.since = data.next_since;
    if (this.onUpdate) this.onUpdate(this);
    return incoming;
  }

  async send(content) {
    const data = await this.request(`/rooms/${this.roomId}/messages`, {
      method: 'POST',
      body: { content },
    });
    if (data && data.message) {
      const exists = this.messages.some((m) => m.id === data.message.id);
      if (!exists) this.messages.push(data.message);
      if (typeof data.next_since === 'number') this.since = Math.max(this.since, data.next_since);
      if (this.onUpdate) this.onUpdate(this);
    }
    return data;
  }

  async refreshMembers() {
    const data = await this.request(`/rooms/${this.roomId}/members`);
    this.members = (data && data.members) || [];
    if (this.onUpdate) this.onUpdate(this);
    return this.members;
  }

  /** 방 주인 키로만 가능: 새 AI 초대 키 발급 */
  async issueKey(aiName) {
    if (!this.isAdmin) throw new Error('방 주인 키가 있어야 초대할 수 있어요');
    const data = await this.request(`/admin/rooms/${this.roomId}/keys`, {
      method: 'POST',
      body: { ai_name: aiName },
    });
    await this.refreshMembers().catch(() => {});
    return data;
  }

  /** 방 주인 키로만 가능: 키 켜기/끄기 */
  async setKeyActive(keyId, active) {
    if (!this.isAdmin) throw new Error('방 주인 키가 있어야 바꿀 수 있어요');
    const data = await this.request(`/admin/keys/${keyId}`, {
      method: 'PATCH',
      body: { active: !!active },
    });
    await this.refreshMembers().catch(() => {});
    return data;
  }

  /** 방 주인 키로만 가능: 키 목록 (키 앞자리·상태만) */
  async listKeys() {
    if (!this.isAdmin) throw new Error('방 주인 키가 있어야 볼 수 있어요');
    const data = await this.request(`/admin/rooms/${this.roomId}/keys`);
    return (data && data.keys) || [];
  }

  /** 방 주인 키로만 가능: AI끼리 대화(토론) 한 라운드를 시작합니다. */
  async discuss({ topic = '', rounds = 2, round = 1 } = {}) {
    if (!this.isAdmin) throw new Error('방 주인 키가 있어야 AI끼리 대화를 시작할 수 있어요');
    return this.request(`/rooms/${this.roomId}/discuss`, {
      method: 'POST',
      body: { topic, rounds, round },
    });
  }

  startPolling(intervalMs = 5000) {
    this.stopPolling();
    this._timer = setInterval(async () => {
      if (this._busy || document.hidden) return;
      if (!this.connected) return;
      this._busy = true;
      try {
        await this.pull();
      } catch (err) {
        if (err && err.status === 429) return; // 잠깐 쉬면 됩니다
        this.setStatus('error', err.message || '연결이 끊겼어요');
      } finally {
        this._busy = false;
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  destroy() {
    this.stopPolling();
    this.setStatus('idle');
  }
}
