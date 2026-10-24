import { replay, RULES_VERSION } from './replay.js';
import { HttpError, json, body, hash, limit, player } from './http.js';
import { contactRoute } from './contacts.js';
function board(mode, pack) {
  if (![30, 60].includes(mode) || !['english', 'code'].includes(pack)) throw new HttpError(400, 'Choose 30s or 60s / English or Code');
}
async function route(request, env, now) {
  const url = new URL(request.url), path = url.pathname;
  if (request.method === 'GET' && path === '/v1/health') return json({ ok: true, rules: RULES_VERSION });
  if (request.method === 'GET' && path === '/v1/leaderboard') {
    const mode = Number(url.searchParams.get('mode') || 30), pack = url.searchParams.get('pack') || 'english';
    board(mode, pack);
    const rules = Number(url.searchParams.get('rules') || RULES_VERSION);
    if (rules !== 1 && rules !== RULES_VERSION) throw new HttpError(400, 'Unknown scoring rules');
    const table = rules === 1 ? 'scores' : 'scores_v2';
    const misses = rules === 1 ? 'NULL' : 's.mistakes';
    const { results } = await env.DB.prepare(`SELECT p.name,s.wpm,s.accuracy,s.words,${misses} AS mistakes,s.recorded_at
      FROM ${table} s JOIN players p ON p.id=s.player_id WHERE s.mode=? AND s.pack=?
      ORDER BY s.wpm DESC,s.accuracy DESC,s.recorded_at ASC,s.player_id ASC LIMIT 100`).bind(mode, pack).all();
    return json({ mode, pack, rules, scores: results.map((score, index) => ({ rank: index + 1, ...score })) });
  }
  if (request.method !== 'POST') throw new HttpError(404, 'Not found');
  // Store a daily hash rather than a raw IP. This is an abuse limit, not identity.
  const address = request.headers.get('CF-Connecting-IP') || 'local';
  const fingerprint = await hash(`${Math.floor(now / 86400000)}:${address}`);
  await limit(env.DB, `write:${fingerprint}`, 180, 3600000, now);
  if (path === '/v1/players') {
    await limit(env.DB, `register:${fingerprint}`, 5, 86400000, now);
    const { name, token: proposedToken } = await body(request);
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{3,12}$/.test(name)) throw new HttpError(400, 'Name: 3-12 letters, digits, _ or -');
    if (proposedToken !== undefined && (typeof proposedToken !== 'string' || !/^[a-f0-9]{64}$/.test(proposedToken))) throw new HttpError(400, 'Invalid player key');
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = proposedToken || [...tokenBytes].map(value => value.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID();
    const result = await env.DB.prepare('INSERT INTO players(id,name,token_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(name) DO NOTHING')
      .bind(id, name, await hash(token), now).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare('SELECT id,name FROM players WHERE name=? AND token_hash=?').bind(name, await hash(token)).first();
      if (existing) return json({ ...existing, token }, 201);
      throw new HttpError(409, 'Name already taken. Choose another.');
    }
    return json({ id, name, token }, 201);
  }
  if (path.startsWith('/v1/contact')) return contactRoute(request, env, now, fingerprint);
  const identity = await player(request, env.DB);
  if (path === '/v1/runs') {
    const { mode, pack, rules } = await body(request); board(mode, pack);
    if (mode !== 30 || pack !== 'english') throw new HttpError(400, 'Online challenges are English / 30 seconds only.');
    if (rules !== RULES_VERSION) throw new HttpError(409, 'Please update taM5CZTyping');
    await limit(env.DB, `run:${identity.id}`, 60, 3600000, now);
    const id = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    const expires = now + 10 * 60000;
    await env.DB.prepare('INSERT INTO runs_v2(id,player_id,mode,pack,seed,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id, identity.id, mode, pack, seed, now, expires).run();
    return json({ id, seed, mode, pack, rules: RULES_VERSION, expires_at: expires }, 201);
  }
  const match = path.match(/^\/v1\/runs\/([a-f0-9-]{36})\/score$/);
  if (!match) throw new HttpError(404, 'Not found');
  const run = await env.DB.prepare('SELECT * FROM runs_v2 WHERE id=? AND player_id=?').bind(match[1], identity.id).first();
  if (!run) throw new HttpError(404, 'Challenge not found');
  if (run.receipt) return json(JSON.parse(run.receipt)); // Idempotent after a lost response.
  if (run.mode !== 30 || run.pack !== 'english') throw new HttpError(409, 'Start a new English / 30 second challenge.');
  if (now > run.expires_at) throw new HttpError(410, 'Challenge expired. Start a new run.');
  if (now - run.created_at < run.mode * 1000) throw new HttpError(409, 'Challenge has not finished');
  const data = await body(request);
  let result;
  try { result = replay(run, data.events); }
  catch (error) { throw new HttpError(400, error.message); }
  if (!result.wpm || !result.words) throw new HttpError(400, 'Complete at least one word to rank');
  const receipt = JSON.stringify({ ...result, name: identity.name, mode: run.mode, pack: run.pack, recorded_at: now });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO scores_v2(player_id,mode,pack,wpm,accuracy,words,mistakes,recorded_at,run_id)
      SELECT player_id,mode,pack,?,?,?,?,?,id FROM runs_v2 WHERE id=? AND receipt IS NULL
      ON CONFLICT(player_id,mode,pack) DO UPDATE SET wpm=excluded.wpm,accuracy=excluded.accuracy,
      words=excluded.words,mistakes=excluded.mistakes,recorded_at=excluded.recorded_at,run_id=excluded.run_id
      WHERE excluded.wpm>scores_v2.wpm OR (excluded.wpm=scores_v2.wpm AND excluded.accuracy>scores_v2.accuracy)`)
      .bind(result.wpm, result.accuracy, result.words, result.mistakes, now, run.id),
    env.DB.prepare('UPDATE runs_v2 SET receipt=? WHERE id=? AND receipt IS NULL').bind(receipt, run.id)
  ]);
  const stored = await env.DB.prepare('SELECT receipt FROM runs_v2 WHERE id=?').bind(run.id).first();
  return json(JSON.parse(stored.receipt));
}
export async function handle(request, env, now = Date.now()) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || 'https://yuk1-kondo.github.io';
  let response;
  try {
    if (origin && origin !== allowed) throw new HttpError(403, 'Origin not allowed');
    if (request.method === 'OPTIONS') {
      response = new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600'
      } });
    } else response = await route(request, env, now);
  } catch (error) {
    // Do not include SQL, request bodies or player keys in errors/logs.
    response = json({ error: error instanceof HttpError ? error.message : 'Service temporarily unavailable' }, error.status || 503);
  }
  response.headers.set('Access-Control-Allow-Origin', allowed);
  response.headers.set('Vary', 'Origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
export default {
  fetch(request, env) { return handle(request, env); },
  async scheduled(_controller, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM runs WHERE expires_at<?').bind(now - 86400000),
      env.DB.prepare('DELETE FROM runs_v2 WHERE expires_at<?').bind(now - 86400000),
      env.DB.prepare('DELETE FROM request_limits WHERE expires_at<?').bind(now),
      env.DB.prepare('DELETE FROM contact_links WHERE expires_at<?').bind(now)
    ]);
  }
};
