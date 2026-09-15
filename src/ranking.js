// ssalmuk_ranking: the Supabase leaderboard shared by all Ssalmuk games (boards: supabase/ranking-boards.sql).
// Calls the two public RPCs over plain fetch, so it needs no bundler or dependency. The URL and publishable
// key are meant to ship in browsers; tables are locked by RLS and only get_leaderboard / submit_score are exposed.
export const SUPABASE_URL = 'https://hneuvqrgbyqlfixmuyhk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_J9wm77W2Nd9JHlBmirE8cA_WmcxCK-N';

const MESSAGES = {
  rate_limited: '잠시 후 다시 시도해 주세요.',
  implausible_score: '기록을 확인할 수 없어 랭킹에 등록되지 않았어요.',
  invalid_name: '이름을 확인해 주세요.',
  invalid_meta: '기록 정보가 올바르지 않아 등록되지 않았어요.',
  unknown_board: '이 코스는 아직 전체 랭킹에 등록되지 않았어요.',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function randomUuid() {
  // crypto.randomUUID is missing on plain-http origins.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function createRanking(gameId, { storagePrefix = gameId, fetchImpl = (...args) => fetch(...args), storage = globalThis.localStorage, timeoutMs = 8000, cacheMs = 20000 } = {}) {
  const cache = new Map();
  let sessionId = null, sessionName = '';
  const read = key => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = (key, value) => { try { storage?.setItem(key, value); return true; } catch { return false; } };

  function playerId() {
    let id = read(`${storagePrefix}.playerId`);
    if (!UUID.test(id ?? '')) { id = sessionId ??= randomUuid(); write(`${storagePrefix}.playerId`, id); }
    return id;
  }
  async function rpc(fn, args) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST', signal: controller.signal, body: JSON.stringify(args),
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = String(data?.message ?? `HTTP ${res.status}`);
        throw Object.assign(new Error(message), { code: Object.keys(MESSAGES).find(k => message.includes(k)) ?? 'server_error' });
      }
      return data;
    } catch (error) {
      if (error.code) throw error;
      throw Object.assign(new Error('offline'), { code: 'offline' });
    } finally { clearTimeout(timer); }
  }

  return {
    gameId,
    playerId,
    getName: fallback => read(`${storagePrefix}.nickname`) || sessionName || fallback,
    setName: name => { sessionName = name; write(`${storagePrefix}.nickname`, name); },
    // { total, higherIsBetter, entries: [{ rank, name, value, meta, at, you }], you: { rank, value, total } | null }
    board(boardId, { fresh = false, limit = 20 } = {}) {
      const key = `${boardId}:${limit}`, hit = cache.get(key);
      if (!fresh && hit && Date.now() - hit.at < cacheMs) return hit.promise;
      const promise = rpc('get_leaderboard', { p_game_id: gameId, p_board_id: boardId, p_limit: limit, p_player_id: playerId() });
      cache.set(key, { at: Date.now(), promise });
      promise.catch(() => cache.delete(key));
      return promise;
    },
    // Resolves { improved, previous, standing: { rank, value, total } }.
    async submit(boardId, { name, value, meta = {} }) {
      const result = await rpc('submit_score', { p_game_id: gameId, p_board_id: boardId, p_player_id: playerId(), p_name: name, p_value: Math.floor(value), p_meta: meta });
      for (const key of cache.keys()) if (key.startsWith(`${boardId}:`)) cache.delete(key);
      return result;
    },
    describeError: error => MESSAGES[error?.code] ?? '랭킹 서버에 연결할 수 없어요.',
  };
}
