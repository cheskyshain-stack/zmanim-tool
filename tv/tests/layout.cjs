const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto((process.env.DISPLAY_TEST_URL || "http://127.0.0.1:8795") + "/admin/display/");
  const dates = ["2026-09-11", "2026-09-12", "2026-09-20", "2026-09-21", "2026-09-25", "2026-10-02", "2026-11-06", "2027-03-26", "2027-04-20", "2027-04-21", "2027-04-27", "2027-06-10", "2027-07-16", "2027-08-12"];
  const result = await p.evaluate(async (dates2) => {
    const { DisplayView } = await import("/display-assets/renderer.js");
    const e = document.createElement("div");
    e.style = "width:1920px;height:1080px;position:fixed;top:0;left:0";
    document.body.append(e);
    const v = new DisplayView(e);
    await document.fonts.ready;
    let out = [];
    for (const d of dates2) {
      const r = await fetch("/api/display/admin/preview", { method: "POST", headers: { "Content-Type": "application/json", "X-Display-Request": "1" }, body: JSON.stringify({ at: d + "T14:00:00Z" }) });
      const s = await r.json();
      s.items = [{ id: "sample", kind: "announcement", title: "DEVELOPMENT SAMPLE", startsAt: "2020", endsAt: null, data: { message: "Sample only", placement: "left", priority: "normal" } }, { id: "ded", kind: "dedication", title: "Sample", startsAt: "2020", endsAt: null, data: { dedicationName: "SAMPLE", anonymous: true } }];
      v.update(s, { preview: true, stale: true });
      out.push({ d, title: s.schedule.today.title, overflow: [...e.querySelectorAll(".tv-panel")].map((x) => x.scrollHeight - x.clientHeight) });
    }
    v.destroy();
    e.remove();
    return out;
  }, dates);
  console.log(result);
  assert.ok(result.every((r) => r.overflow.every((n) => n <= 2)));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
