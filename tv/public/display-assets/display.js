import { DisplayView } from "./renderer.js";
const host = document.querySelector("#screen");
host.style.height = "100vh";
const view = new DisplayView(host);
let data = null, lastSuccess = 0, failed = false, boundaryTimer, inflight = false;
async function refresh() {
  if (inflight) return;
  inflight = true;
  try {
    const r = await fetch("/api/display/public", { cache: "no-store", signal: AbortSignal.timeout(1e4) });
    if (!r.ok) throw Error();
    data = await r.json();
    lastSuccess = performance.now();
    failed = false;
    clearTimeout(boundaryTimer);
    if (data.nextChangeAt) {
      const delay = Date.parse(data.nextChangeAt) - Date.parse(data.at) + 50;
      if (delay >= 0 && delay < 2147483647) boundaryTimer = setTimeout(refresh, Math.max(100, delay));
    }
  } catch {
    failed = true;
  } finally {
    inflight = false;
  }
  draw();
}
function draw() {
  if (data) view.update(data, { now: Date.parse(data.at) + performance.now() - lastSuccess, stale: failed || performance.now() - lastSuccess > 45e3 });
  else host.querySelector(".tv-stage").innerHTML = '<p class="boot">Schedule unavailable. Reconnecting…</p>';
}
setInterval(refresh, 15e3);
setInterval(draw, 1e3);
addEventListener("online", refresh);
addEventListener("offline", () => {
  failed = true;
  draw();
});
refresh();
