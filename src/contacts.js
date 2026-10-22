import { HttpError, json, body, hash, limit, player } from './http.js';
export const CONTACT_PURPOSE = 'competition-results-v1';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 30) throw new HttpError(400, 'Invalid contact code');
  const code = value.replace(/[-\s]/g, '').toUpperCase();
  if (code.length !== 12 || [...code].some(character => !alphabet.includes(character))) throw new HttpError(400, 'Invalid contact code');
  return code;
}
function normalizeEmail(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter an email address');
  const email = value.trim();
  if (email.length > 254 || !/^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  const at = email.lastIndexOf('@');
  if (email.slice(0, at).includes('..')) throw new HttpError(400, 'Enter a valid email address');
  return email.slice(0, at + 1) + email.slice(at + 1).toLowerCase();
}
export async function contactRoute(request, env, now, fingerprint) {
  const path = new URL(request.url).pathname;
  if (path === '/v1/contact-links') {
    const identity = await player(request, env.DB);
    await limit(env.DB, `contact-link:${identity.id}`, 10, 3600000, now);
    const code = [...crypto.getRandomValues(new Uint8Array(12))].map(byte => alphabet[byte & 31]).join('');
    const expires = now + 600000;
    await env.DB.batch([
      env.DB.prepare('UPDATE contact_links SET expires_at=? WHERE player_id=? AND used_at IS NULL').bind(now - 1, identity.id),
      env.DB.prepare('INSERT INTO contact_links(code_hash,player_id,expires_at) VALUES(?,?,?)').bind(await hash(code), identity.id, expires)
    ]);
    return json({ code, name: identity.name, expires_at: expires, expires_in: 600,
      url: `https://yuk1-kondo.github.io/key-dash-ranking/#contact=${code}` }, 201);
  }
  if (!['/v1/contact-links/lookup', '/v1/contact'].includes(path)) throw new HttpError(404, 'Not found');
  await limit(env.DB, `contact:${fingerprint}`, 30, 600000, now);
  const data = await body(request), code = normalizeCode(data.code), codeHash = await hash(code);
  const link = await env.DB.prepare(`SELECT l.*,p.name FROM contact_links l JOIN players p ON p.id=l.player_id
    WHERE l.code_hash=?`).bind(codeHash).first();
  if (!link || now >= link.expires_at) throw new HttpError(410, 'Contact code expired. Get a new code in KEY DASH.');
  if (path === '/v1/contact-links/lookup') {
    if (link.used_at !== null) throw new HttpError(409, 'Contact code already used. Get a new code in KEY DASH.');
    const contact = await env.DB.prepare('SELECT 1 AS registered FROM player_contacts WHERE player_id=?').bind(link.player_id).first();
    return json({ name: link.name, expires_at: link.expires_at, has_contact: Boolean(contact), purpose: CONTACT_PURPOSE });
  }
  if (!['save', 'delete'].includes(data.action)) throw new HttpError(400, 'Choose save or delete');
  const email = data.action === 'save' ? normalizeEmail(data.email) : '';
  if (data.action === 'save' && (data.consent !== true || data.purpose !== CONTACT_PURPOSE)) throw new HttpError(400, 'Contact consent is required');
  const digest = await hash(JSON.stringify([data.action, email, data.action === 'save' ? CONTACT_PURPOSE : '']));
  if (link.used_at !== null) {
    if (link.request_hash === digest) return json({ action: link.action, saved: link.action === 'save' });
    throw new HttpError(409, 'Contact code already used. Get a new code in KEY DASH.');
  }
  const mutation = data.action === 'save'
    ? env.DB.prepare(`INSERT INTO player_contacts(player_id,email,consent_version,consented_at,updated_at)
        SELECT player_id,?,?,?,? FROM contact_links WHERE code_hash=? AND used_at IS NULL AND expires_at>?
        ON CONFLICT(player_id) DO UPDATE SET email=excluded.email,consent_version=excluded.consent_version,
        consented_at=excluded.consented_at,updated_at=excluded.updated_at`).bind(email, CONTACT_PURPOSE, now, now, codeHash, now)
    : env.DB.prepare(`DELETE FROM player_contacts WHERE player_id=(SELECT player_id FROM contact_links
        WHERE code_hash=? AND used_at IS NULL AND expires_at>?)`).bind(codeHash, now);
  await env.DB.batch([
    mutation,
    env.DB.prepare(`UPDATE contact_links SET used_at=?,request_hash=?,action=?
      WHERE code_hash=? AND used_at IS NULL AND expires_at>?`).bind(now, digest, data.action, codeHash, now)
  ]);
  const stored = await env.DB.prepare('SELECT request_hash,action FROM contact_links WHERE code_hash=?').bind(codeHash).first();
  if (stored.request_hash !== digest) throw new HttpError(409, 'Contact code already used. Get a new code in KEY DASH.');
  return json({ action: stored.action, saved: stored.action === 'save' });
}
