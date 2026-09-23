import test from "node:test";
import assert from "node:assert/strict";
import { localToISO, phase } from "../public/display-assets/time.js";
import { dateInfo, scheduleSnapshot, source } from "../src/schedules.js";
import { validate, publicItems, conflicts } from "../src/model.js";
import { allow, identity } from "../src/auth.js";
import worker from "../src/worker.js";
const base = process.env.DISPLAY_TEST_URL || "http://127.0.0.1:8795";
async function api(path, method = "GET", data, expected = 200) {
  const r = await fetch(base + "/api/display/admin/" + path, { method, headers: { "Content-Type": "application/json", Origin: base, "X-Display-Request": "1" }, body: data === void 0 ? void 0 : JSON.stringify(data) });
  const body = await r.json();
  assert.equal(r.status, expected, JSON.stringify(body));
  return body;
}
const announcement = { kind: "announcement", status: "published", title: "DEVELOPMENT SAMPLE", internalName: "PRIVATE INTERNAL NAME", startLocal: "2026-09-23T09:00", endLocal: "2026-09-23T10:00", data: { message: "DEVELOPMENT SAMPLE. Test announcement.", placement: "left", priority: "normal", behavior: "rotating" } };
test("NY boundaries, DST ambiguity and Hebrew sunset conversion", () => {
  assert.equal(localToISO("2026-09-23T09:00"), "2026-09-23T13:00:00.000Z");
  assert.throws(() => localToISO("2026-03-08T02:30"), /does not exist/);
  assert.throws(() => localToISO("2026-11-01T01:30"), /twice/);
  assert.equal(localToISO("2026-11-01T01:30", "earlier"), "2026-11-01T05:30:00.000Z");
  assert.equal(localToISO("2026-11-01T01:30", "later"), "2026-11-01T06:30:00.000Z");
  const item = validate(announcement);
  assert.equal(phase(item, "2026-09-23T12:59:59.000Z"), "scheduled");
  assert.equal(phase(item, item.startsAt), "showing");
  assert.equal(phase(item, item.endsAt), "expired");
  const info = dateInfo("2026-09-23");
  assert.equal(info.hebrew.year, 5787);
  assert.equal(info.hebrew.dayOfMonth, 12);
  assert.equal(dateInfo(null, { day: 12, month: 7, year: 5787 }).date, info.date);
  assert.ok(info.previousSunset < info.civilStart);
  assert.ok(info.sunset < info.civilEnd);
  const dst = dateInfo("2026-03-08");
  assert.equal(Date.parse(dst.civilEnd) - Date.parse(dst.civilStart), 23 * 36e5);
  assert.throws(() => dateInfo(null, { day: 31, month: 7, year: 5787 }));
});
test("privacy and fail-closed permissions", async () => {
  const item = { ...validate({ ...announcement, kind: "dedication", data: { sponsor: "PRIVATE SPONSOR", anonymous: true, dedicationName: "DEVELOPMENT SAMPLE", sponsorshipDate: "2026-09-23", timing: "civil" } }), id: "test" };
  const rendered = publicItems([item], item.startsAt);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].data.sponsor, void 0);
  assert.equal(rendered[0].internalName, void 0);
  assert.deepEqual(publicItems([{ ...item, status: "draft" }, { ...item, status: "hidden" }, { ...item, status: "archived" }], item.startsAt), []);
  assert.throws(() => allow({ capabilities: ["announcements"] }, "dedication"), /permission/);
  allow({ capabilities: ["announcements", "dedications"] }, "dedication");
  assert.equal((await worker.fetch(new Request("https://example.com/api/display/admin/items"), {})).status, 503);
  assert.equal((await worker.fetch(new Request("https://example.com/admin/display/"), { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "test" })).status, 401);
  await assert.rejects(identity(new Request("https://example.com/admin/display/"), { LOCAL_DEVELOPMENT: "true" }));
  const r = await fetch(base + "/api/display/admin/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(announcement) });
  assert.equal(r.status, 403);
});
test("existing holiday source takes precedence and partial schedules preserve other services", () => {
  const yk = scheduleSnapshot("2026-09-21T12:00:00.000Z");
  assert.ok(yk.today.events.some((e) => e.name === "מנחה" && e.time === "4:15"));
  assert.ok(!yk.today.events.some((e) => e.name === "מנחה" && e.time === "1:20"));
  const control = { id: "one", ...validate({ kind: "schedule", status: "published", title: "DEVELOPMENT SAMPLE", startLocal: "2026-09-21T00:00", endLocal: "2026-09-22T00:00", data: { source: "yk:5787", appliesFrom: "2026-09-21", appliesTo: "2026-09-21", portion: "mincha", precedence: 41 } }) };
  const partial = scheduleSnapshot("2026-09-21T12:00:00.000Z", [control]);
  assert.deepEqual(partial.today.events.filter((e) => e.name === "שחרית"), yk.today.events.filter((e) => e.name === "שחרית"));
  assert.equal(conflicts(control, [{ ...control, id: "two" }]).length, 1);
  assert.equal(conflicts(control, [{ ...control, id: "two", data: { ...control.data, portion: "maariv" } }]).length, 0);
  const pesach = source("pesach:5787");
  for (const day of [...new Set(pesach.events.map((e) => e.serial))]) {
    assert.ok(Number.isFinite(day));
  }
  assert.doesNotThrow(() => validate({ kind: "schedule", status: "draft", data: { source: "yk:5787" } }));
});
test("D1 create, edit, duplication, hiding, expiry, fresh sessions and schedule conflict workflow", async () => {
  const saved = [];
  try {
    let item = await api("items", "POST", announcement, 201);
    saved.push(item.id);
    assert.ok((await api("items")).find((x) => x.id === item.id));
    let preview = await api("preview", "POST", { at: item.startsAt });
    assert.ok(preview.items.find((x) => x.id === item.id));
    assert.ok(!JSON.stringify(preview.items).includes("PRIVATE INTERNAL NAME"));
    preview = await api("preview", "POST", { at: item.endsAt });
    assert.ok(!preview.items.find((x) => x.id === item.id));
    item = await api("items/" + item.id, "PUT", { ...announcement, version: item.version, title: "DEVELOPMENT SAMPLE EDITED" });
    assert.equal(item.version, 2);
    await api("items/" + item.id, "PUT", { ...announcement, version: 1 }, 409);
    const copy = await api("items/" + item.id + "/duplicate", "POST", {}, 201);
    saved.push(copy.id);
    assert.equal(copy.status, "draft");
    assert.equal(copy.startsAt, null);
    assert.equal(copy.endsAt, null);
    await api("items/" + item.id + "/hide", "POST", { version: item.version });
    preview = await api("preview", "POST", { at: item.startsAt });
    assert.ok(!preview.items.find((x) => x.id === item.id));
    for (const timing of ["evening", "civil", "custom"]) {
      const raw = { ...announcement, kind: "dedication", data: { sponsor: "PRIVATE SPONSOR", anonymous: true, dedicationName: "DEVELOPMENT SAMPLE " + timing, sponsorshipDate: "2026-09-23", timing } };
      let d = await api("items", "POST", raw, 201);
      saved.push(d.id);
      d = await api("items/" + d.id, "PUT", { ...raw, version: d.version, data: { ...raw.data, message: "DEVELOPMENT SAMPLE EDIT" } });
      assert.equal(d.version, 2);
      const p = await api("preview", "POST", { at: d.startsAt });
      assert.equal(p.items.find((x) => x.id === d.id).data.sponsor, void 0);
      const dup = await api("items/" + d.id + "/duplicate", "POST", {}, 201);
      saved.push(dup.id);
      assert.equal(dup.data.sponsorshipDate, "");
      assert.equal(dup.startsAt, null);
    }
    const rule = { kind: "schedule", status: "published", title: "DEVELOPMENT SAMPLE", startLocal: "2026-09-21T00:00", endLocal: "2026-09-22T00:00", data: { source: "yk:5787", appliesFrom: "2026-09-21", appliesTo: "2026-09-21", portion: "mincha", precedence: 41, previewLocal: "2026-09-20T00:00" } };
    let s = await api("items", "POST", rule, 201);
    saved.push(s.id);
    await api("items", "POST", { ...rule, data: { ...rule.data, precedence: 42 } }, 409);
    const s2 = await api("items", "POST", { ...rule, data: { ...rule.data, precedence: 42, overlapAcknowledged: true } }, 201);
    saved.push(s2.id);
    const upcoming = await api("preview", "POST", { at: "2026-09-20T12:00:00.000Z" });
    assert.ok(upcoming.upcoming.find((x) => x.id === s.id));
    s = await api("items/" + s.id, "PUT", { ...rule, version: s.version, data: { ...rule.data, overlapAcknowledged: true } });
    assert.equal(s.version, 2);
    const sd = await api("items/" + s.id + "/duplicate", "POST", {}, 201);
    saved.push(sd.id);
    assert.equal(sd.status, "draft");
    assert.equal(sd.startsAt, null);
  } finally {
    const rows = await api("items");
    for (const id of saved) {
      const item = rows.find((i) => i.id === id);
      if (item) await api("items/" + id + "/archive", "POST", { version: item.version });
    }
  }
});
test("overlap enforcement remains atomic for concurrent saves", async () => {
  const data = { kind: "schedule", status: "published", title: "DEVELOPMENT SAMPLE CONCURRENT", startLocal: "2027-10-10T00:00", endLocal: "2027-10-11T00:00", data: { source: "yk:5788", appliesFrom: "2027-10-10", appliesTo: "2027-10-10", portion: "mincha", precedence: 99 } };
  const responses = await Promise.all([1, 2].map(() => fetch(base + "/api/display/admin/items", { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-Display-Request": "1" }, body: JSON.stringify(data) })));
  const bodies = await Promise.all(responses.map((r) => r.json()));
  try {
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409], JSON.stringify(bodies));
  } finally {
    for (const row of bodies) if (row.id) await api("items/" + row.id + "/archive", "POST", { version: row.version });
  }
});
test("a partial special source preserves normal afternoon and evening schedules", () => {
  const at = "2026-09-22T12:00:00.000Z";
  const before = scheduleSnapshot(at);
  const rule = validate({ kind: "schedule", status: "published", title: "DEVELOPMENT SAMPLE", startLocal: "2026-09-22T00:00", endLocal: "2026-09-23T00:00", data: { source: "yk:5787", appliesFrom: "2026-09-22", appliesTo: "2026-09-22", portion: "all", precedence: 1 } });
  const after = scheduleSnapshot(at, [rule]);
  for (const name of ["מנחה", "מעריב"]) assert.deepEqual(after.today.events.filter((e) => e.name === name), before.today.events.filter((e) => e.name === name));
});
