const MAX_BODY = 80000;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
export async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Missing JSON');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error();
    return result;
  } catch { throw new HttpError(400, 'Invalid JSON'); }
}
export async function limit(db, bucket, maximum, windowMs, now) {
  const window = Math.floor(now / windowMs);
  const result = await db.prepare(`INSERT INTO request_limits(bucket,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`)
    .bind(`${bucket}:${window}`, (window + 1) * windowMs).first();
  if (result.count > maximum) throw new HttpError(429, 'Too many requests. Try later.');
}
export async function player(request, db) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new HttpError(401, 'Player registration required');
  const result = await db.prepare('SELECT id,name FROM players WHERE token_hash=?').bind(await hash(token)).first();
  if (!result) throw new HttpError(401, 'Player key not recognized');
  return result;
}
