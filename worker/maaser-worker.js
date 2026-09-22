/* Backend for /maaser/, the Income and Maaser Tracker. The only place in this project that
 * writes and not just reads: it is a real database, reached over HTTPS, and everything below
 * exists to keep one household's giving records private to the link that opens them.
 *
 * Deploying it, once:
 *
 *   1. Cloudflare dashboard, Workers and Pages, Create, paste this file, deploy. Give it any
 *      name (e.g. maaser-tracker).
 *   2. Storage and Databases, D1 SQL Database, Create, any name (e.g. maaser-tracker). Then
 *      on this Worker, Settings, Bindings, add a D1 binding called exactly MAASER_DB pointing
 *      at it.
 *   3. Load the schema once: `wrangler d1 execute <database-name> --remote --file=worker/maaser-schema.sql`
 *      (from this repo, with wrangler logged into the shul's Cloudflare account).
 *   4. Give the Worker's address to whoever is editing the site, and it goes in
 *      MAASER_API in maaser/app.js.
 *
 * That is the whole deploy: no secret to set here at all, because nothing this Worker holds
 * is worth anything without also holding a token that only ever existed in one browser's
 * clipboard. D1 gets automatic point-in-time recovery (Cloudflare's "Time Travel", 30 days)
 * with nothing to configure; that is the backup this project has. It is not a second,
 * independent copy anywhere else, which is worth saying plainly rather than leaving implied.
 *
 * What this Worker never does: it never returns a stored token or recovery code. Both are
 * generated, handed back once in the response to the request that created or rotated them,
 * and only their SHA-256 hash is kept. A row in `trackers` that lost its one response is a
 * row nothing here can open again outside the recovery flow, on purpose. See CLAUDE.md's
 * admin PIN section for the shape of a *deliberately* weak gate (four digits, worth saying
 * so); this is the opposite: a 256-bit secret that this file goes out of its way to never
 * log, echo, or store in the clear.
 */

/* Who may call this. Not a security boundary (the token is), but it keeps another site from
   quietly spending a visitor's browser against this Worker and passing the result off as
   its own, the same reasoning as traffic-worker.js. */
const ALLOWED_ORIGINS = [
  'https://tools.cjaffa.com',
  'https://baismedrashoflakewoodcommons.org',
  'https://lczmanim.cjaffa.com',
  'http://localhost',
  'http://127.0.0.1',
];

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/* How long a retried "create tracker" request can still be answered with the same token
   instead of minting a second tracker. Long enough to cover a phone's own retry after a
   dropped connection, short enough that the plaintext token sitting in create_idempotency
   is gone well before anyone but the original browser could plausibly replay the request. */
const CREATE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

/* Rate limit windows, in requests per hour per bucket. Creation is the one an anonymous
   flood can hurt (an empty tracker is nearly free to make), so it is the tightest. PIN and
   recovery attempts are guarding a secret with far less entropy than the token itself, so
   they are rate limited too, per token or per IP as noted below. */
const LIMITS = {
  create: { windowMs: 60 * 60 * 1000, max: 12 },
  open: { windowMs: 60 * 60 * 1000, max: 120 },
  pin: { windowMs: 60 * 60 * 1000, max: 20 },
  recovery: { windowMs: 60 * 60 * 1000, max: 8 },
  write: { windowMs: 60 * 60 * 1000, max: 600 },
};

// ---------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o + ':'));
  const headers = {
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-tracker-pin, x-maaser-admin-key, idempotency-key',
    'vary': 'origin',
  };
  if (allowed) headers['access-control-allow-origin'] = origin;
  return headers;
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request) },
  });
}

function fail(request, status, code, message) {
  return json(request, { error: code, message }, status);
}

function newId() {
  return crypto.randomUUID();
}

/* The access token and the recovery code are the same shape: 32 random bytes (256 bits),
   base32 (Crockford, no padding) so they are easy to read back off a phone screen and to
   select without the ambiguity of 0/O or 1/I/l. Neither is ever guessable from the other:
   they are drawn independently. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  // Grouped for reading and retyping, e.g. "ABCDE-FGHJK-...". Purely cosmetic: it is
  // stripped before hashing or comparing, so a link or code pasted without the dashes
  // still works.
  return out.match(/.{1,5}/g).join('-');
}

function normalizeSecret(s) {
  return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* PIN hashing. A PIN is a handful of digits, not 256 bits, so unlike the token it has to
   assume an attacker who already has the database and is trying every value: PBKDF2-SHA256
   at 100,000 iterations with a random salt per tracker, which is what Web Crypto offers
   natively in a Worker (no native bcrypt/argon2 here). Slow enough to make offline guessing
   costly, not so slow it makes a phone wait. */
const PIN_ITERATIONS = 100000;

async function hashPin(pin, saltHex) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PIN_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256
  );
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const saltHexOut = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hashHex, saltHex: saltHexOut };
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------------------
// Rate limiting: one row per (kind, key, hour-window). Read-then-write rather than a single
// atomic increment, because D1 has no UPSERT-with-increment in one round trip that also
// reports the resulting count cheaply across environments; the tiny race between two
// requests in the same millisecond costs at most one extra request through, which is not
// worth a stricter lock for a limiter whose job is blunting abuse, not billing it exactly.
// ---------------------------------------------------------------------------------------

async function rateLimit(db, kind, key) {
  const cfg = LIMITS[kind];
  const windowStart = Math.floor(Date.now() / cfg.windowMs) * cfg.windowMs;
  const bucket = `${kind}:${key}:${windowStart}`;
  const row = await db.prepare('SELECT count FROM rate_limits WHERE bucket = ?').bind(bucket).first();
  const count = (row ? row.count : 0) + 1;
  if (count > cfg.max) return false;
  if (row) {
    await db.prepare('UPDATE rate_limits SET count = ? WHERE bucket = ?').bind(count, bucket).run();
  } else {
    await db.prepare('INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, ?, ?)')
      .bind(bucket, count, windowStart).run();
    // Lazily sweep windows that ended over a day ago, one in every ~50 requests, so the
    // table does not grow forever without needing a cron trigger just for housekeeping.
    if (Math.random() < 0.02) {
      await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Date.now() - 86400000).run();
    }
  }
  return true;
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

// ---------------------------------------------------------------------------------------
// Auth: resolve a request's Authorization header (and, if the tracker has one set, its
// X-Tracker-Pin header) to a tracker row. Every handler that touches a tracker's data goes
// through this; nothing ever trusts a tracker id supplied by the client.
// ---------------------------------------------------------------------------------------

async function authenticate(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return { error: fail(request, 401, 'no_token', 'Missing access token.') };
  const token = normalizeSecret(m[1]);
  if (token.length < 20) return { error: fail(request, 401, 'bad_token', 'That does not look like a tracker link.') };

  const ip = clientIp(request);
  if (!(await rateLimit(env.MAASER_DB, 'open', ip))) {
    return { error: fail(request, 429, 'rate_limited', 'Too many attempts. Try again later.') };
  }

  const tokenHash = await sha256Hex(token);
  const tracker = await env.MAASER_DB.prepare('SELECT * FROM trackers WHERE token_hash = ?').bind(tokenHash).first();
  if (!tracker) return { error: fail(request, 401, 'invalid_token', 'This link does not open a tracker. Check that it was copied in full.') };

  const managed = await env.MAASER_DB.prepare('SELECT status FROM managed_trackers WHERE tracker_id = ?').bind(tracker.id).first();
  if (managed?.status === 'pending') return { error: fail(request, 403, 'pin_setup_required', 'Create your PIN to activate this tracker.') };
  tracker.managed = !!managed;

  if (tracker.pin_hash) {
    if (tracker.pin_locked_until && tracker.pin_locked_until > Date.now()) {
      return { error: fail(request, 423, 'pin_locked', 'Too many wrong PIN attempts. Try again in a few minutes.') };
    }
    const pin = (request.headers.get('x-tracker-pin') || '').trim();
    if (!pin) return { error: fail(request, 401, 'pin_required', 'Enter the PIN for this tracker.') };
    if (!(await rateLimit(env.MAASER_DB, 'pin', tracker.id))) {
      return { error: fail(request, 429, 'rate_limited', 'Too many attempts. Try again later.') };
    }
    const { hashHex } = await hashPin(pin, tracker.pin_salt);
    if (!timingSafeEqual(hashHex, tracker.pin_hash)) {
      const failCount = (tracker.pin_fail_count || 0) + 1;
      const lockedUntil = failCount >= 5 ? Date.now() + 5 * 60 * 1000 : null;
      await env.MAASER_DB.prepare('UPDATE trackers SET pin_fail_count = ?, pin_locked_until = ? WHERE id = ?')
        .bind(failCount, lockedUntil, tracker.id).run();
      return { error: fail(request, 401, 'wrong_pin', 'Wrong PIN.') };
    }
    if (tracker.pin_fail_count) {
      await env.MAASER_DB.prepare('UPDATE trackers SET pin_fail_count = 0, pin_locked_until = NULL WHERE id = ?')
        .bind(tracker.id).run();
    }
  }
  return { tracker };
}

// ---------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------

async function handleCreate(request, env) {
  const ip = clientIp(request);
  const idemKey = (request.headers.get('idempotency-key') || '').trim();
  const now = Date.now();

  if (idemKey) {
    const existing = await env.MAASER_DB.prepare(
      'SELECT * FROM create_idempotency WHERE idem_key = ? AND expires_at > ?'
    ).bind(idemKey, now).first();
    if (existing) {
      return json(request, { token: existing.token, recoveryCode: existing.recovery_code }, 201);
    }
  }

  if (!(await rateLimit(env.MAASER_DB, 'create', ip))) {
    return fail(request, 429, 'rate_limited', 'Too many trackers created from this connection recently. Try again later.');
  }

  const id = newId();
  const token = randomSecret();
  const recoveryCode = randomSecret();
  const tokenHash = await sha256Hex(normalizeSecret(token));
  const recoveryHash = await sha256Hex(normalizeSecret(recoveryCode));

  await env.MAASER_DB.prepare(
    'INSERT INTO trackers (id, token_hash, recovery_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, tokenHash, recoveryHash, now, now).run();

  // A starter source so a brand new tracker is not a blank screen with nowhere to click;
  // matches the spec's own example sources and its own default percent.
  await env.MAASER_DB.prepare(
    'INSERT INTO sources (id, tracker_id, name, default_percent, sort_order, archived, created_at, updated_at) VALUES (?, ?, ?, 10, 0, 0, ?, ?)'
  ).bind(newId(), id, 'Salary', now, now).run();

  if (idemKey) {
    await env.MAASER_DB.prepare(
      'INSERT INTO create_idempotency (idem_key, tracker_id, token, recovery_code, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(idemKey, id, token, recoveryCode, now + CREATE_IDEMPOTENCY_TTL_MS).run();
    await env.MAASER_DB.prepare('DELETE FROM create_idempotency WHERE expires_at < ?').bind(now).run();
  }

  return json(request, { token, recoveryCode }, 201);
}

async function loadState(db, trackerId) {
  const [sources, income, giving, allocations, opening] = await Promise.all([
    db.prepare('SELECT * FROM sources WHERE tracker_id = ? ORDER BY sort_order, created_at').bind(trackerId).all(),
    db.prepare('SELECT * FROM income_entries WHERE tracker_id = ? ORDER BY entry_date, created_at').bind(trackerId).all(),
    db.prepare('SELECT * FROM giving_entries WHERE tracker_id = ? ORDER BY entry_date, created_at').bind(trackerId).all(),
    db.prepare(
      'SELECT ga.* FROM giving_allocations ga JOIN giving_entries ge ON ge.id = ga.giving_id WHERE ge.tracker_id = ?'
    ).bind(trackerId).all(),
    db.prepare('SELECT * FROM opening_balances WHERE tracker_id = ? ORDER BY entry_date').bind(trackerId).all(),
  ]);
  return {
    sources: sources.results,
    income: income.results,
    giving: giving.results,
    allocations: allocations.results,
    opening: opening.results,
  };
}

async function handleGetState(request, env, tracker) {
  const state = await loadState(env.MAASER_DB, tracker.id);
  return json(request, { ...state, pinEnabled: !!tracker.pin_hash, adminManaged: !!tracker.managed });
}

function requireNumber(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, 'invalid_input', `${field} must be a number.`);
  return n;
}
function toCents(dollars, field) {
  const n = requireNumber(dollars, field);
  return Math.round(n * 100);
}
function requireDate(v, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) throw new HttpError(400, 'invalid_input', `${field} must be a date.`);
  return v;
}
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Malformed request body.');
  }
}

const WRITE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

/* Wraps a POST handler that creates a record: if the client sent an Idempotency-Key and this
   tracker has already answered that exact key recently, the earlier response is replayed
   instead of running the handler again. This is what stops a duplicate income or giving entry
   from a repeated tap or a retry after a dropped connection, the general case of the same
   mechanism handleCreate uses for the tracker itself. */
async function withIdempotency(request, env, tracker, handler) {
  const key = (request.headers.get('idempotency-key') || '').trim();
  if (!key) return handler();
  const now = Date.now();
  const existing = await env.MAASER_DB.prepare(
    'SELECT response_body, response_status FROM write_idempotency WHERE idem_key = ? AND tracker_id = ? AND expires_at > ?'
  ).bind(key, tracker.id, now).first();
  if (existing) {
    return new Response(existing.response_body, {
      status: existing.response_status,
      headers: { ...JSON_HEADERS, ...corsHeaders(request) },
    });
  }
  const response = await handler();
  // Only cache success: a failed attempt (bad input, a momentary error) should be free to
  // retry for real rather than replaying the same failure forever.
  if (response.status >= 200 && response.status < 300) {
    const body = await response.clone().text();
    await env.MAASER_DB.prepare(
      'INSERT OR REPLACE INTO write_idempotency (idem_key, tracker_id, response_body, response_status, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(key, tracker.id, body, response.status, now + WRITE_IDEMPOTENCY_TTL_MS).run();
    if (Math.random() < 0.02) {
      await env.MAASER_DB.prepare('DELETE FROM write_idempotency WHERE expires_at < ?').bind(now).run();
    }
  }
  return response;
}

async function assertOwnedSource(db, trackerId, sourceId) {
  const row = await db.prepare('SELECT id FROM sources WHERE id = ? AND tracker_id = ?').bind(sourceId, trackerId).first();
  if (!row) throw new HttpError(404, 'not_found', 'That income source was not found on this tracker.');
}

// --- sources ---------------------------------------------------------------------------

async function handleCreateSource(request, env, tracker) {
  const body = await readJson(request);
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'invalid_input', 'Give the source a name.');
  const percent = body.defaultPercent != null ? requireNumber(body.defaultPercent, 'defaultPercent') : 10;
  const now = Date.now();
  const countRow = await env.MAASER_DB.prepare('SELECT COUNT(*) AS n FROM sources WHERE tracker_id = ?').bind(tracker.id).first();
  const id = newId();
  await env.MAASER_DB.prepare(
    'INSERT INTO sources (id, tracker_id, name, default_percent, sort_order, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
  ).bind(id, tracker.id, name, percent, countRow.n, now, now).run();
  return json(request, { id }, 201);
}

async function handleUpdateSource(request, env, tracker, sourceId) {
  await assertOwnedSource(env.MAASER_DB, tracker.id, sourceId);
  const body = await readJson(request);
  const sets = [];
  const args = [];
  if (body.name != null) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'invalid_input', 'Give the source a name.');
    sets.push('name = ?'); args.push(name);
  }
  if (body.defaultPercent != null) { sets.push('default_percent = ?'); args.push(requireNumber(body.defaultPercent, 'defaultPercent')); }
  if (body.archived != null) { sets.push('archived = ?'); args.push(body.archived ? 1 : 0); }
  if (body.sortOrder != null) { sets.push('sort_order = ?'); args.push(requireNumber(body.sortOrder, 'sortOrder')); }
  if (!sets.length) return json(request, { ok: true });
  sets.push('updated_at = ?'); args.push(Date.now());
  args.push(sourceId, tracker.id);
  await env.MAASER_DB.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ? AND tracker_id = ?`).bind(...args).run();
  return json(request, { ok: true });
}

// --- income ------------------------------------------------------------------------------

async function handleCreateIncome(request, env, tracker) {
  const body = await readJson(request);
  await assertOwnedSource(env.MAASER_DB, tracker.id, body.sourceId);
  const amountCents = toCents(body.amount, 'amount');
  if (amountCents <= 0) throw new HttpError(400, 'invalid_input', 'Amount must be greater than zero.');
  const date = requireDate(body.date, 'date');
  const percent = requireNumber(body.percent, 'percent');
  const maaserCents = Math.round(amountCents * percent / 100);
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;
  const now = Date.now();
  const id = newId();
  await env.MAASER_DB.prepare(
    `INSERT INTO income_entries (id, tracker_id, source_id, amount_cents, entry_date, note, percent, maaser_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tracker.id, body.sourceId, amountCents, date, note, percent, maaserCents, now, now).run();
  return json(request, { id, maaserCents }, 201);
}

async function handleUpdateIncome(request, env, tracker, entryId) {
  const existing = await env.MAASER_DB.prepare('SELECT * FROM income_entries WHERE id = ? AND tracker_id = ?').bind(entryId, tracker.id).first();
  if (!existing) throw new HttpError(404, 'not_found', 'That income entry was not found.');
  const body = await readJson(request);
  const sourceId = body.sourceId != null ? body.sourceId : existing.source_id;
  if (body.sourceId != null) await assertOwnedSource(env.MAASER_DB, tracker.id, sourceId);
  const amountCents = body.amount != null ? toCents(body.amount, 'amount') : existing.amount_cents;
  const date = body.date != null ? requireDate(body.date, 'date') : existing.entry_date;
  const percent = body.percent != null ? requireNumber(body.percent, 'percent') : existing.percent;
  const note = body.note !== undefined ? (body.note ? String(body.note).trim().slice(0, 500) : null) : existing.note;
  const maaserCents = Math.round(amountCents * percent / 100);
  await env.MAASER_DB.prepare(
    `UPDATE income_entries SET source_id = ?, amount_cents = ?, entry_date = ?, percent = ?, maaser_cents = ?, note = ?, updated_at = ?
     WHERE id = ? AND tracker_id = ?`
  ).bind(sourceId, amountCents, date, percent, maaserCents, note, Date.now(), entryId, tracker.id).run();
  return json(request, { ok: true, maaserCents });
}

async function handleDeleteIncome(request, env, tracker, entryId) {
  await env.MAASER_DB.prepare('DELETE FROM income_entries WHERE id = ? AND tracker_id = ?').bind(entryId, tracker.id).run();
  return json(request, { ok: true });
}

// --- giving (with optional split allocations) -------------------------------------------

function validateAllocations(allocations, totalCents) {
  if (!Array.isArray(allocations) || !allocations.length) {
    throw new HttpError(400, 'invalid_input', 'A donation needs at least one income source.');
  }
  let sum = 0;
  for (const a of allocations) {
    const cents = toCents(a.amount, 'allocation amount');
    if (cents <= 0) throw new HttpError(400, 'invalid_input', 'Each allocation must be greater than zero.');
    sum += cents;
  }
  if (sum !== totalCents) {
    throw new HttpError(400, 'allocations_mismatch', 'The split amounts must add up to the total donation.');
  }
}

async function handleCreateGiving(request, env, tracker) {
  const body = await readJson(request);
  const amountCents = toCents(body.amount, 'amount');
  if (amountCents <= 0) throw new HttpError(400, 'invalid_input', 'Amount must be greater than zero.');
  const date = requireDate(body.date, 'date');
  const recipient = body.recipient ? String(body.recipient).trim().slice(0, 120) : null;
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  const allocations = Array.isArray(body.allocations) && body.allocations.length
    ? body.allocations
    : [{ sourceId: body.sourceId, amount: body.amount }];
  validateAllocations(allocations, amountCents);
  for (const a of allocations) await assertOwnedSource(env.MAASER_DB, tracker.id, a.sourceId);

  const now = Date.now();
  const givingId = newId();
  const statements = [
    env.MAASER_DB.prepare(
      `INSERT INTO giving_entries (id, tracker_id, amount_cents, entry_date, recipient, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(givingId, tracker.id, amountCents, date, recipient, note, now, now),
  ];
  for (const a of allocations) {
    statements.push(
      env.MAASER_DB.prepare('INSERT INTO giving_allocations (id, giving_id, source_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(newId(), givingId, a.sourceId, toCents(a.amount, 'allocation amount'))
    );
  }
  // D1's batch runs as one transaction: every statement commits together or none do, so a
  // split donation can never leave some sources credited and others not.
  await env.MAASER_DB.batch(statements);
  return json(request, { id: givingId }, 201);
}

async function handleUpdateGiving(request, env, tracker, givingId) {
  const existing = await env.MAASER_DB.prepare('SELECT * FROM giving_entries WHERE id = ? AND tracker_id = ?').bind(givingId, tracker.id).first();
  if (!existing) throw new HttpError(404, 'not_found', 'That giving entry was not found.');
  const body = await readJson(request);
  const amountCents = body.amount != null ? toCents(body.amount, 'amount') : existing.amount_cents;
  const date = body.date != null ? requireDate(body.date, 'date') : existing.entry_date;
  const recipient = body.recipient !== undefined ? (body.recipient ? String(body.recipient).trim().slice(0, 120) : null) : existing.recipient;
  const note = body.note !== undefined ? (body.note ? String(body.note).trim().slice(0, 500) : null) : existing.note;

  const statements = [
    env.MAASER_DB.prepare(
      'UPDATE giving_entries SET amount_cents = ?, entry_date = ?, recipient = ?, note = ?, updated_at = ? WHERE id = ? AND tracker_id = ?'
    ).bind(amountCents, date, recipient, note, Date.now(), givingId, tracker.id),
  ];
  if (body.allocations) {
    validateAllocations(body.allocations, amountCents);
    for (const a of body.allocations) await assertOwnedSource(env.MAASER_DB, tracker.id, a.sourceId);
    statements.push(env.MAASER_DB.prepare('DELETE FROM giving_allocations WHERE giving_id = ?').bind(givingId));
    for (const a of body.allocations) {
      statements.push(
        env.MAASER_DB.prepare('INSERT INTO giving_allocations (id, giving_id, source_id, amount_cents) VALUES (?, ?, ?, ?)')
          .bind(newId(), givingId, a.sourceId, toCents(a.amount, 'allocation amount'))
      );
    }
  } else if (body.amount != null) {
    // Amount changed but the split was not resent: if this was a single-source donation,
    // scale its one allocation to match so it cannot silently drift from the new total.
    const allocs = await env.MAASER_DB.prepare('SELECT * FROM giving_allocations WHERE giving_id = ?').bind(givingId).all();
    if (allocs.results.length === 1) {
      statements.push(
        env.MAASER_DB.prepare('UPDATE giving_allocations SET amount_cents = ? WHERE id = ?')
          .bind(amountCents, allocs.results[0].id)
      );
    } else {
      throw new HttpError(400, 'allocations_mismatch', 'This donation is split across sources; resend the split amounts along with the new total.');
    }
  }
  await env.MAASER_DB.batch(statements);
  return json(request, { ok: true });
}

async function handleDeleteGiving(request, env, tracker, givingId) {
  await env.MAASER_DB.batch([
    env.MAASER_DB.prepare('DELETE FROM giving_allocations WHERE giving_id = ?').bind(givingId),
    env.MAASER_DB.prepare('DELETE FROM giving_entries WHERE id = ? AND tracker_id = ?').bind(givingId, tracker.id),
  ]);
  return json(request, { ok: true });
}

// --- opening balances ----------------------------------------------------------------------

async function handleCreateOpening(request, env, tracker) {
  const body = await readJson(request);
  await assertOwnedSource(env.MAASER_DB, tracker.id, body.sourceId);
  const amountCents = toCents(body.amount, 'amount');
  if (amountCents <= 0) throw new HttpError(400, 'invalid_input', 'Amount must be greater than zero.');
  const type = body.type === 'ahead' ? 'ahead' : body.type === 'remaining' ? 'remaining' : null;
  if (!type) throw new HttpError(400, 'invalid_input', 'type must be "remaining" or "ahead".');
  const date = requireDate(body.date, 'date');
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;
  const now = Date.now();
  const id = newId();
  await env.MAASER_DB.prepare(
    `INSERT INTO opening_balances (id, tracker_id, source_id, balance_type, amount_cents, entry_date, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, tracker.id, body.sourceId, type, amountCents, date, note, now, now).run();
  return json(request, { id }, 201);
}

async function handleDeleteOpening(request, env, tracker, id) {
  await env.MAASER_DB.prepare('DELETE FROM opening_balances WHERE id = ? AND tracker_id = ?').bind(id, tracker.id).run();
  return json(request, { ok: true });
}

// --- settings: PIN ------------------------------------------------------------------------

async function handleSetPin(request, env, tracker) {
  const body = await readJson(request);
  if (body.pin === null || body.pin === '') {
    if (tracker.managed) return fail(request, 403, 'admin_required', 'Ask the admin to reset access.');
    await env.MAASER_DB.prepare('UPDATE trackers SET pin_hash = NULL, pin_salt = NULL, pin_fail_count = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?')
      .bind(Date.now(), tracker.id).run();
    return json(request, { ok: true, pinEnabled: false });
  }
  const pin = String(body.pin);
  if (!new RegExp(tracker.managed ? '^\\d{6,10}$' : '^\\d{4,10}$').test(pin)) throw new HttpError(400, 'invalid_input', tracker.managed ? 'PIN must be 6 to 10 digits.' : 'PIN must be 4 to 10 digits.');
  const { hashHex, saltHex } = await hashPin(pin);
  await env.MAASER_DB.prepare('UPDATE trackers SET pin_hash = ?, pin_salt = ?, pin_fail_count = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?')
    .bind(hashHex, saltHex, Date.now(), tracker.id).run();
  return json(request, { ok: true, pinEnabled: true });
}

// --- recovery ------------------------------------------------------------------------------

async function handleRecovery(request, env) {
  const ip = clientIp(request);
  if (!(await rateLimit(env.MAASER_DB, 'recovery', ip))) {
    return fail(request, 429, 'rate_limited', 'Too many recovery attempts. Try again later.');
  }
  const body = await readJson(request);
  const code = normalizeSecret(body.recoveryCode);
  if (code.length < 20) return fail(request, 400, 'invalid_input', 'That does not look like a recovery code.');
  const hash = await sha256Hex(code);
  const tracker = await env.MAASER_DB.prepare('SELECT * FROM trackers WHERE recovery_hash = ?').bind(hash).first();
  if (!tracker) return fail(request, 401, 'invalid_code', 'That recovery code was not recognized.');
  if (await env.MAASER_DB.prepare('SELECT tracker_id FROM managed_trackers WHERE tracker_id = ?').bind(tracker.id).first()) {
    return fail(request, 403, 'admin_required', 'Ask the admin for a new link.');
  }

  const newToken = randomSecret();
  const newRecovery = randomSecret();
  const newTokenHash = await sha256Hex(normalizeSecret(newToken));
  const newRecoveryHash = await sha256Hex(normalizeSecret(newRecovery));
  const clearPin = !!body.resetPin;

  const sets = ['token_hash = ?', 'recovery_hash = ?', 'updated_at = ?'];
  const args = [newTokenHash, newRecoveryHash, Date.now()];
  if (clearPin) {
    sets.push('pin_hash = NULL', 'pin_salt = NULL', 'pin_fail_count = 0', 'pin_locked_until = NULL');
  }
  await env.MAASER_DB.prepare(`UPDATE trackers SET ${sets.join(', ')} WHERE id = ?`).bind(...args, tracker.id).run();

  // Rotating both the token and the recovery code here is what "invalidate the previous
  // link and active access sessions" and "rotate the recovery code after use" mean in
  // practice: there is no session store to clear, only this row's two hashes, and both just
  // changed, so the old link and the old recovery code both stop working immediately.
  return json(request, { token: newToken, recoveryCode: newRecovery, pinCleared: clearPin });
}

// ---------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------

async function adminAuthorized(request, env) {
  const supplied = request.headers.get('x-maaser-admin-key') || '';
  if (!env.MAASER_ADMIN_KEY || supplied.length < 32 || supplied.length > 256) return false;
  const [a, b] = await Promise.all([sha256Hex(supplied), sha256Hex(env.MAASER_ADMIN_KEY)]);
  return timingSafeEqual(a, b);
}

async function handleAdminCreate(request, env) {
  const body = await readJson(request);
  const label = String(body.label || '').trim();
  if (!label || label.length > 100) return fail(request, 400, 'invalid_input', 'Enter a name (up to 100 characters).');
  const now = Date.now(), id = newId(), token = randomSecret();
  const tokenHash = await sha256Hex(normalizeSecret(token));
  const recoveryHash = await sha256Hex(normalizeSecret(randomSecret()));
  await env.MAASER_DB.batch([
    env.MAASER_DB.prepare('INSERT INTO trackers (id, token_hash, recovery_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, tokenHash, recoveryHash, now, now),
    env.MAASER_DB.prepare('INSERT INTO sources (id, tracker_id, name, default_percent, sort_order, archived, created_at, updated_at) VALUES (?, ?, ?, 10, 0, 0, ?, ?)').bind(newId(), id, 'Salary', now, now),
    env.MAASER_DB.prepare('INSERT INTO managed_trackers (tracker_id, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, label, 'pending', now, now),
  ]);
  return json(request, { id, label, status: 'pending', token }, 201);
}

async function handleAdminReset(request, env, id) {
  const managed = await env.MAASER_DB.prepare('SELECT tracker_id FROM managed_trackers WHERE tracker_id = ?').bind(id).first();
  if (!managed) return fail(request, 404, 'not_found', 'Tracker not found.');
  const token = randomSecret(), tokenHash = await sha256Hex(normalizeSecret(token)), now = Date.now();
  await env.MAASER_DB.batch([
    env.MAASER_DB.prepare('UPDATE trackers SET token_hash = ?, pin_hash = NULL, pin_salt = NULL, pin_fail_count = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?').bind(tokenHash, now, id),
    env.MAASER_DB.prepare("UPDATE managed_trackers SET status = 'pending', updated_at = ? WHERE tracker_id = ?").bind(now, id),
  ]);
  return json(request, { id, status: 'pending', token });
}

async function handleActivate(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) return fail(request, 401, 'no_token', 'Missing invitation link.');
  if (!(await rateLimit(env.MAASER_DB, 'open', clientIp(request)))) return fail(request, 429, 'rate_limited', 'Too many attempts. Try again later.');
  const tokenHash = await sha256Hex(normalizeSecret(match[1]));
  const tracker = await env.MAASER_DB.prepare('SELECT id FROM trackers WHERE token_hash = ?').bind(tokenHash).first();
  if (!tracker) return fail(request, 401, 'invalid_token', 'This invitation is no longer valid. Ask the admin for a new link.');
  const body = await readJson(request), pin = String(body.pin || '');
  if (!/^\d{6,10}$/.test(pin)) return fail(request, 400, 'invalid_input', 'PIN must be 6 to 10 digits.');
  const { hashHex, saltHex } = await hashPin(pin), now = Date.now();
  const result = await env.MAASER_DB.prepare("UPDATE trackers SET pin_hash = ?, pin_salt = ?, pin_fail_count = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ? AND token_hash = ? AND pin_hash IS NULL AND EXISTS (SELECT 1 FROM managed_trackers WHERE tracker_id = ? AND status = 'pending')")
    .bind(hashHex, saltHex, now, tracker.id, tokenHash, tracker.id).run();
  if (result.meta.changes !== 1) return fail(request, 409, 'already_activated', 'This invitation has already been used. Ask the admin for a new link if needed.');
  await env.MAASER_DB.prepare("UPDATE managed_trackers SET status = 'active', updated_at = ? WHERE tracker_id = ? AND status = 'pending'").bind(now, tracker.id).run();
  return json(request, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (!env.MAASER_DB) {
      return fail(request, 500, 'not_configured', 'This Worker has no MAASER_DB database binding yet.');
    }

    try {
      if (path.startsWith('/api/admin/')) {
        if (!(await adminAuthorized(request, env))) return fail(request, 401, 'admin_required', 'Admin key required.');
        if (path === '/api/admin/trackers' && request.method === 'GET') {
          const rows = await env.MAASER_DB.prepare('SELECT tracker_id AS id, label, status, created_at, updated_at FROM managed_trackers ORDER BY created_at DESC').all();
          return json(request, { trackers: rows.results });
        }
        if (path === '/api/admin/trackers' && request.method === 'POST') return await handleAdminCreate(request, env);
        const reset = /^\/api\/admin\/trackers\/([a-f0-9-]+)\/reset$/.exec(path);
        if (reset && request.method === 'POST') return await handleAdminReset(request, env, reset[1]);
        return fail(request, 404, 'not_found', 'Unknown admin endpoint.');
      }
      if (path === '/api/trackers' && request.method === 'POST') return fail(request, 403, 'admin_required', 'Ask the admin to create a tracker.');
      if (path === '/api/activate' && request.method === 'POST') return await handleActivate(request, env);
      if (path === '/api/recovery' && request.method === 'POST') {
        return await handleRecovery(request, env);
      }

      // Everything past this point needs a valid Authorization header (and PIN, if set).
      const m = /^\/api\/(.+)$/.exec(path);
      if (!m) return fail(request, 404, 'not_found', 'Unknown endpoint.');
      const { tracker, error } = await authenticate(request, env);
      if (error) return error;

      if (!(await rateLimit(env.MAASER_DB, 'write', tracker.id)) && request.method !== 'GET') {
        return fail(request, 429, 'rate_limited', 'Too many changes in a short time. Wait a moment and try again.');
      }

      const parts = m[1].split('/');
      if (parts[0] === 'state' && request.method === 'GET') return await handleGetState(request, env, tracker);
      if (parts[0] === 'sources' && parts.length === 1 && request.method === 'POST') return await withIdempotency(request, env, tracker, () => handleCreateSource(request, env, tracker));
      if (parts[0] === 'sources' && parts.length === 2 && request.method === 'PATCH') return await handleUpdateSource(request, env, tracker, parts[1]);
      if (parts[0] === 'income' && parts.length === 1 && request.method === 'POST') return await withIdempotency(request, env, tracker, () => handleCreateIncome(request, env, tracker));
      if (parts[0] === 'income' && parts.length === 2 && request.method === 'PATCH') return await handleUpdateIncome(request, env, tracker, parts[1]);
      if (parts[0] === 'income' && parts.length === 2 && request.method === 'DELETE') return await handleDeleteIncome(request, env, tracker, parts[1]);
      if (parts[0] === 'giving' && parts.length === 1 && request.method === 'POST') return await withIdempotency(request, env, tracker, () => handleCreateGiving(request, env, tracker));
      if (parts[0] === 'giving' && parts.length === 2 && request.method === 'PATCH') return await handleUpdateGiving(request, env, tracker, parts[1]);
      if (parts[0] === 'giving' && parts.length === 2 && request.method === 'DELETE') return await handleDeleteGiving(request, env, tracker, parts[1]);
      if (parts[0] === 'opening' && parts.length === 1 && request.method === 'POST') return await withIdempotency(request, env, tracker, () => handleCreateOpening(request, env, tracker));
      if (parts[0] === 'opening' && parts.length === 2 && request.method === 'DELETE') return await handleDeleteOpening(request, env, tracker, parts[1]);
      if (parts[0] === 'settings' && parts[1] === 'pin' && request.method === 'POST') return await handleSetPin(request, env, tracker);

      return fail(request, 404, 'not_found', 'Unknown endpoint.');
    } catch (err) {
      if (err instanceof HttpError) return fail(request, err.status, err.code, err.message);
      console.error(err);
      return fail(request, 500, 'server_error', 'Something went wrong saving that. Nothing was lost; try again.');
    }
  },
};
