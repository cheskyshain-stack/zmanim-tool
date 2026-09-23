import { actor, allow, ApiError, CAPABILITIES } from "./auth.js";
import { validate, conflicts, publicItem, publicItems, warnings, text } from "./model.js";
import { scheduleSnapshot, catalog, dateInfo } from "./schedules.js";
import { phase, localStamp } from "../public/display-assets/time.js";
const json = (x, status = 200) => Response.json(x, { status });
const decode = (r) => ({ id: r.id, kind: r.kind, status: r.status, internalName: r.internal_name, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at, data: JSON.parse(r.data_json), version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, updatedBy: r.updated_by });
const list = async (db) => (await db.prepare("SELECT * FROM display_items ORDER BY updated_at DESC").all()).results.map(decode);
async function body(req) {
  if (!req.headers.get("Content-Type")?.includes("application/json")) throw new ApiError(415, "Expected JSON.");
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing body.");
  let chunks = [], n = 0;
  while (true) {
    const x = await reader.read();
    if (x.done) break;
    n += x.value.length;
    if (n > 2e4) {
      await reader.cancel();
      throw new ApiError(413, "This item is too large.");
    }
    chunks.push(x.value);
  }
  const bytes = new Uint8Array(n);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}
async function snapshot(items, at, preview = false) {
  const controls = items.filter((i) => i.kind === "schedule"), schedule = scheduleSnapshot(at, controls);
  const boundaries = items.filter((i) => i.status === "published").flatMap((i) => [i.startsAt, i.endsAt, i.data.previewAt]).filter((x) => x && x > at);
  const today = dateInfo(schedule.date);
  boundaries.push(today.civilEnd);
  if (today.sunset > at) boundaries.push(today.sunset);
  if (schedule.next) boundaries.push(schedule.next.at);
  return { at, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), nextChangeAt: boundaries.sort()[0] || null, preview, items: publicItems(items, at), upcoming: controls.filter((i) => i.status === "published" && i.data.previewAt && i.data.previewAt <= at && at < i.startsAt).map(publicItem), schedule, warnings: preview ? warnings(items, at) : [] };
}
async function handle(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (path === "/api/display/public" && req.method === "GET") {
    const at = new Date().toISOString();
    const items = (await env.DB.prepare("SELECT * FROM display_items WHERE status='published' AND (ends_at IS NULL OR ends_at>?)").bind(at).all()).results.map(decode);
    return json(await snapshot(items, at));
  }
  const isAdmin = path.startsWith("/admin/display") || path.startsWith("/api/display/");
  let who;
  if (isAdmin) who = await actor(req, env);
  if (path.startsWith("/api/display/")) {
    if (!["GET", "HEAD"].includes(req.method) && (req.headers.get("Origin") !== url.origin || req.headers.get("X-Display-Request") !== "1")) throw new ApiError(403, "Submit from the display admin.");
    if (path === "/api/display/admin/me") return json({ ...who, local: who.email === "local-admin" });
    if (path === "/api/display/admin/items" && req.method === "GET") {
      const rows = await list(env.DB);
      return json(rows.filter((i) => who.capabilities.includes("full") || who.capabilities.includes({ announcement: "announcements", dedication: "dedications", schedule: "schedules" }[i.kind])).map((i) => ({ ...i, phase: phase(i, (/* @__PURE__ */ new Date()).toISOString()) })));
    }
    if (path === "/api/display/admin/catalog") {
      const year = Number(url.searchParams.get("year"));
      if (!Number.isInteger(year) || year < 5700 || year > 5900) throw new ApiError(422, "Choose a Hebrew year from 5700 to 5900.");
      return json(catalog(year).map(({ events, ...p }) => ({ ...p, eventCount: events.length })));
    }
    if (path === "/api/display/admin/date" && req.method === "POST") {
      const d = await body(req);
      return json(dateInfo(d.date, d.hebrew));
    }
    if (path === "/api/display/admin/preview" && req.method === "POST") {
      const raw = await body(req), at = new Date(raw.at).toISOString();
      if (+new Date(at) < Date.parse("2000-01-01") || +new Date(at) > Date.parse("2100-01-01")) throw new ApiError(422, "Choose a preview between 2000 and 2099.");
      let items = await list(env.DB);
      if (raw.item) {
        allow(who, raw.item.kind);
        const draft = validate({ ...raw.item, status: "published" });
        items = items.filter((i) => i.id !== raw.item.id);
        items.push({ ...draft, id: raw.item.id || "unsaved-preview" });
      }
      const result = await snapshot(items, at, true);
      result.timeline = items.filter((i) => who.capabilities.includes("full") || who.capabilities.includes({ announcement: "announcements", dedication: "dedications", schedule: "schedules" }[i.kind])).map((i) => ({ id: i.id, title: i.internalName || i.title, phase: phase(i, at) }));
      return json(result);
    }
    if (path === "/api/display/admin/permissions") {
      allow(who, "full");
      if (req.method === "GET") return json((await env.DB.prepare("SELECT * FROM display_permissions ORDER BY email").all()).results);
      if (req.method === "POST") {
        const d = await body(req), email = text(d.email).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Array.isArray(d.capabilities) || d.capabilities.some((c) => !CAPABILITIES.includes(c))) throw new ApiError(422, "Enter an email and valid permissions.");
        await env.DB.batch([env.DB.prepare("INSERT INTO display_permissions VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(email, JSON.stringify(d.capabilities), (/* @__PURE__ */ new Date()).toISOString(), who.email), env.DB.prepare("INSERT INTO display_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), null, "permissions:" + email, who.email, (/* @__PURE__ */ new Date()).toISOString(), null)]);
        return json({ ok: true });
      }
    }
    const match = path.match(/^\/api\/display\/admin\/items(?:\/([\w-]+))?(?:\/(duplicate|hide|archive))?$/);
    if (match && ["POST", "PUT"].includes(req.method)) {
      const [, id, action] = match, raw = await body(req);
      const old = id ? (await list(env.DB)).find((i) => i.id === id) : null;
      if (id && !old) throw new ApiError(404, "Item not found.");
      if (old) allow(who, old.kind);
      if (action) {
        if (!old) throw new ApiError(404, "Item not found.");
        if (action === "duplicate") {
          raw.kind = old.kind;
          raw.title = old.title;
          raw.internalName = (old.internalName || old.title) + " (copy)";
          raw.data = { ...old.data };
          if (old.kind === "dedication") raw.data.sponsorshipDate = "";
          raw.status = "draft";
          raw.startLocal = "";
          raw.endLocal = "";
        } else {
          if (raw.version !== old.version) throw new ApiError(409, "This item changed. Reopen it first.");
          const status = action === "hide" ? "hidden" : "archived", at = (/* @__PURE__ */ new Date()).toISOString();
          const results2 = await env.DB.batch([env.DB.prepare("UPDATE display_items SET status=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?").bind(status, at, who.email, id, raw.version), env.DB.prepare("INSERT INTO display_audit SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(), id, action, who.email, at, old.version + 1)]);
          if (!results2[0].meta.changes) throw new ApiError(409, "This item changed. Reopen it first.");
          return json({ ok: true });
        }
      }
      allow(who, raw.kind);
      const value = validate(raw), itemId = action === "duplicate" || !id ? crypto.randomUUID() : id, updating = !!old && action !== "duplicate";
      if (updating && old.kind !== value.kind) throw new ApiError(422, "Item type cannot be changed.");
      if (updating && raw.version !== old.version) throw new ApiError(409, "This item changed. Reopen it first.");
      const overlaps = conflicts({ ...value, id: itemId }, await list(env.DB));
      if (overlaps.length && (!value.data.overlapAcknowledged || overlaps.some((i) => i.data.precedence === value.data.precedence))) throw new ApiError(409, "Overlapping schedule: acknowledge the conflict and choose a distinct precedence. Higher numbers win.");
      const now = (/* @__PURE__ */ new Date()).toISOString(), args = [value.kind, value.status, value.internalName, value.title, value.startsAt, value.endsAt, JSON.stringify(value.data), now, who.email];
      const mutation = updating ? env.DB.prepare("UPDATE display_items SET kind=?,status=?,internal_name=?,title=?,starts_at=?,ends_at=?,data_json=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND version=?").bind(...args, itemId, raw.version) : env.DB.prepare("INSERT INTO display_items(kind,status,internal_name,title,starts_at,ends_at,data_json,updated_at,updated_by,id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(...args, itemId, now, who.email);
      let results;
      try {
        results = await env.DB.batch([mutation, env.DB.prepare("INSERT INTO display_audit SELECT ?,?,?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(), itemId, action || (updating ? "updated" : "created"), who.email, now, updating ? old.version + 1 : 1)]);
      } catch (e) {
        if (String(e).includes("display_schedule_conflict")) throw new ApiError(409, "Overlapping schedule: review the conflict and choose a distinct precedence.");
        throw e;
      }
      if (!results[0].meta.changes) throw new ApiError(409, "This item changed. Reopen it first.");
      return json((await list(env.DB)).find((i) => i.id === itemId), updating ? 200 : 201);
    }
    throw new ApiError(404, "Not found.");
  }
  if (!["GET", "HEAD"].includes(req.method)) throw new ApiError(405, "Method not allowed.");
  return env.ASSETS.fetch(req);
}
export default { async fetch(req, env) {
  let response;
  try {
    response = await handle(req, env);
  } catch (e) {
    response = json({ error: e instanceof ApiError || e instanceof RangeError ? e.message : "Unable to complete this request.", ...env.LOCAL_DEVELOPMENT === "true" ? { detail: e.message } : {} }, e.status || (e instanceof RangeError ? 422 : 500));
  }
  const r = new Response(response.body, response);
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("X-Robots-Tag", "noindex");
  r.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  return r;
} };
