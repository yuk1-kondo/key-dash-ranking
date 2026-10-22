import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { handle } from '../src/worker.js';
import { replay, wordStream } from '../src/replay.js';
class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const database = this.sqlite;
    function statement(parameters = []) {
      return {
        bind: (...values) => statement(values),
        first: async () => database.prepare(sql).get(...parameters) || null,
        all: async () => ({ results: database.prepare(sql).all(...parameters) }),
        run: async () => ({ meta: database.prepare(sql).run(...parameters) })
      };
    }
    return statement();
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
let env;
beforeEach(() => { env = { DB: new LocalD1(), ALLOWED_ORIGIN: 'https://yuk1-kondo.github.io' }; });
async function request(path, data, token, now = 1000000, extra = {}) {
  const headers = { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await handle(new Request(`https://ranking.example/v1${path}`, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data) }), env, now);
  return { status: response.status, data: await response.json(), response };
}
async function register(name = 'TestPlayer') {
  const response = await request('/players', { name }); assert.equal(response.status, 201); return response.data;
}
async function challenge(token, mode = 30, pack = 'english', now = 1000000) {
  const response = await request('/runs', { mode, pack, rules: 1 }, token, now); assert.equal(response.status, 201); return response.data;
}
function eventsFor(run, count = 8) {
  const next = wordStream(run.seed, run.pack); const events = [];
  let time = 0;
  for (let i = 0; i < count; i++) for (const key of next() + ' ') { events.push([time, key]); time += 100; }
  return events;
}
test('public registration, challenge, score replay, persisted ranking and idempotent retry', async () => {
  const player = await register(), run = await challenge(player.token), events = eventsFor(run);
  const early = await request(`/runs/${run.id}/score`, { events }, player.token, 1000100); assert.equal(early.status, 409);
  const score = await request(`/runs/${run.id}/score`, { events, wpm: 999 }, player.token, 1030000);
  assert.equal(score.status, 200); assert.deepEqual({ wpm: score.data.wpm, accuracy: score.data.accuracy, words: score.data.words }, replay(run, events));
  assert.equal(score.data.accuracy, 100); assert.equal(score.data.words, 8); assert.notEqual(score.data.wpm, 999);
  const repeated = await request(`/runs/${run.id}/score`, { events: [] }, player.token, 1031000); assert.deepEqual(repeated.data, score.data);
  const board = await request('/leaderboard?mode=30&pack=english'); assert.equal(board.status, 200); assert.equal(board.data.scores.length, 1); assert.equal(board.data.scores[0].name, player.name);
  assert.equal(JSON.stringify(board.data).includes(player.token), false);
  assert.equal((await request('/leaderboard?mode=60&pack=english')).data.scores.length, 0);
});
test('names are validated and reserved case-insensitively; keys protect each player', async () => {
  const player = await register();
  assert.equal((await request('/players', { name: 'testplayer' })).status, 409);
  assert.equal((await request('/players', { name: '<script>' })).status, 400);
  assert.equal((await request('/runs', { mode: 30, pack: 'english', rules: 1 })).status, 401);
  const run = await challenge(player.token), second = await register('OtherPlayer');
  assert.equal((await request(`/runs/${run.id}/score`, { events: eventsFor(run) }, second.token, 1030000)).status, 404);
});
test('only a personal best replaces the board; 4 independent boards', async () => {
  const player = await register();
  for (const [count, now] of [[8, 1000000], [2, 1100000], [12, 1200000]]) {
    const run = await challenge(player.token, 30, 'english', now);
    assert.equal((await request(`/runs/${run.id}/score`, { events: eventsFor(run, count) }, player.token, now + 30000)).status, 200);
  }
  const board = (await request('/leaderboard')).data.scores; assert.equal(board.length, 1); assert.equal(board[0].words, 12);
  const run = await challenge(player.token, 60, 'code', 1300000);
  await request(`/runs/${run.id}/score`, { events: eventsFor(run) }, player.token, 1360000);
  assert.equal((await request('/leaderboard?mode=60&pack=code')).data.scores.length, 1);
});
test('expired, invalid mode/version, hostile origins and oversized bodies fail clearly', async () => {
  const player = await register(), run = await challenge(player.token);
  assert.equal((await request(`/runs/${run.id}/score`, { events: eventsFor(run) }, player.token, 2000000)).status, 410);
  assert.equal((await request('/runs', { mode: 0, pack: 'english', rules: 1 }, player.token)).status, 400);
  assert.equal((await request('/runs', { mode: 30, pack: 'english', rules: 2 }, player.token)).status, 409);
  assert.equal((await request('/players', { name: 'Nope' }, undefined, 1000000, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/players', { name: 'A'.repeat(81000) })).status, 413);
});
test('per-IP registration rate limit', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await request('/players', { name: `Player${i}` })).status, 201);
  assert.equal((await request('/players', { name: 'Player6' })).status, 429);
});
test('replay matches corrections, rejects late/out-of-order events and never counts erased text twice', () => {
  const run = { seed: 1, mode: 30, pack: 'english' }, next = wordStream(1, 'english'), word = next();
  const correct = [...word + ' '].map((key, i) => [i * 100, key]);
  const repaired = [[0, 'z'], [100, '\b'], ...correct.map(([t, k]) => [t + 200, k])];
  assert.equal(replay(run, correct).wpm, replay(run, repaired).wpm);
  assert.ok(replay(run, repaired).accuracy < 100);
  const rewritten = [[0, word[0]], [100, '\b'], ...correct.map(([t, k]) => [t + 200, k])];
  assert.equal(replay(run, rewritten).wpm, replay(run, correct).wpm);
  for (const events of [[], [[1, 'a']], [[0, '\b']], [[0, 'a'], [30000, 'b']], [[0, 'a'], [20, 'b'], [10, 'c']], [[0, '\n']]]) assert.throws(() => replay(run, events));
});
test('server dictionaries match the native source exactly', { skip: !existsSync(new URL('../../src/model/typing_model.cpp', import.meta.url)) }, () => {
  const source = readFileSync(new URL('../../src/model/typing_model.cpp', import.meta.url), 'utf8');
  const dictionaries = JSON.parse(readFileSync(new URL('../src/words.json', import.meta.url), 'utf8'));
  for (const pack of ['english', 'code']) {
    const section = source.match(new RegExp(`${pack}_words\\[\\] = \\{([\\s\\S]*?)\\};`))[1];
    assert.deepEqual([...section.matchAll(/"([a-z]+)"/g)].map(match => match[1]), dictionaries[pack]);
  }
});

test('lost registration response can be retried with a client-generated key', async () => {
  const token = 'a'.repeat(64);
  const first = await request('/players', { name: 'RetryPlayer', token });
  const second = await request('/players', { name: 'RetryPlayer', token });
  assert.equal(first.status, 201); assert.deepEqual(second.data, first.data);
  assert.equal((await request('/players', { name: 'RetryPlayer', token: 'b'.repeat(64) })).status, 409);
});
