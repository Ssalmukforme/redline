import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRanking, escapeHtml, SUPABASE_URL } from '../src/ranking.js';
import { RANKING_GAME, BOARDS } from '../src/ranking-boards.js';

test('supabase/ranking-boards.sql registers exactly the boards the game uses', async () => {
  const sql = await readFile(new URL('../supabase/ranking-boards.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`insert into public\\.games \\(id, name\\) values \\('${RANKING_GAME}'`));
  const rows = [...sql.matchAll(/\('([\w-]+)', '([\w-]+)', '([^']+)', (true|false), (\d+), (\d+)(?:, (?:'(\w+)'|null), (\d+))?\)/g)]
    .map(m => ({ game: m[1], id: m[2], name: m[3], higherIsBetter: m[4] === 'true', min: Number(m[5]), max: Number(m[6]), ...(m[7] ? { penaltyKey: m[7], penaltyPer: Number(m[8]) } : {}) }));
  assert.ok(rows.every(r => r.game === RANKING_GAME));
  assert.deepEqual(rows.map(({ game, ...r }) => r), BOARDS);
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  };
  return { calls, fetchImpl };
}
function memoryStorage() { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) }; }

test('the client calls the shared RPCs with a stable anonymous player id and caches boards', async () => {
  const board = { total: 1, entries: [{ rank: 1, name: 'a', value: 1000, you: true }], you: { rank: 1, value: 1000, total: 1 } };
  const { calls, fetchImpl } = fakeFetch([{ status: 200, body: board }, { status: 200, body: { improved: true, standing: { rank: 1, total: 1 } } }, { status: 200, body: board }]);
  const storage = memoryStorage(), ranking = createRanking(RANKING_GAME, { fetchImpl, storage });
  assert.deepEqual(await ranking.board(BOARDS[0].id), board);
  await ranking.board(BOARDS[0].id);
  assert.equal(calls.length, 1, 'second read is served from cache');
  await ranking.submit(BOARDS[0].id, { name: 'a', value: 1234.9, meta: { x: 1 } });
  await ranking.board(BOARDS[0].id);
  assert.equal(calls.length, 3, 'submitting invalidates the cached board');
  assert.equal(calls[0].url, `${SUPABASE_URL}/rest/v1/rpc/get_leaderboard`);
  assert.equal(calls[1].url, `${SUPABASE_URL}/rest/v1/rpc/submit_score`);
  assert.ok(calls[0].init.headers.apikey.startsWith('sb_publishable_'));
  assert.deepEqual({ ...calls[1].body, p_player_id: undefined }, { p_game_id: RANKING_GAME, p_board_id: BOARDS[0].id, p_player_id: undefined, p_name: 'a', p_value: 1234, p_meta: { x: 1 } });
  assert.equal(calls[0].body.p_player_id, calls[1].body.p_player_id);
  assert.equal(createRanking(RANKING_GAME, { fetchImpl, storage }).playerId(), calls[0].body.p_player_id, 'id survives a reload');
});

test('errors map to friendly codes and the game keeps working offline', async () => {
  const { fetchImpl } = fakeFetch([{ status: 400, body: { code: 'P0001', message: 'implausible_score' } }, { status: 400, body: { message: 'rate_limited' } }, new TypeError('Failed to fetch'), { status: 500, body: null }]);
  const ranking = createRanking(RANKING_GAME, { fetchImpl, storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  for (const code of ['implausible_score', 'rate_limited', 'offline', 'server_error']) {
    await assert.rejects(ranking.submit(BOARDS[0].id, { name: 'x', value: 1 }), e => e.code === code);
  }
  assert.match(ranking.describeError({ code: 'offline' }), /연결할 수 없어요/);
  assert.equal(ranking.playerId(), ranking.playerId(), 'blocked storage still yields one id per session');
  assert.equal(escapeHtml(`<b>"x"&'y'</b>`), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
});
