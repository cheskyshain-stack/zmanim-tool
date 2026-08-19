"""Publishing a season for the congregation.

Nothing here goes near the real site. GitHub is replaced by a stub that records what it was
asked to do, which is the only honest way to check the merge: publishing one season must
leave every other one standing, and that is a rule about what gets written, not about
whether a request succeeded.

    python3 desktop/tests/test_publish.py
"""
import base64
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "desktop"))

from zmanimboard import publish as publishlib  # noqa: E402


class Report:
    def __init__(self):
        self.rows = []
        self.failed = False

    def expect(self, name, ok, detail=""):
        self.rows.append((name, bool(ok), detail))
        if not ok:
            self.failed = True

    def equal(self, name, want, got):
        self.expect(name, want == got, "" if want == got else f"\n      want {want!r}\n      got  {got!r}")

    def summary(self):
        width = max(len(n) for n, _, _ in self.rows)
        for name, ok, detail in self.rows:
            print(f"  {'ok  ' if ok else 'FAIL'} {name.ljust(width)}  {detail}")
        print(f"\n  {sum(1 for _, ok, _ in self.rows if ok)} of {len(self.rows)} checks passed.")
        return not self.failed


R = Report()


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeGitHub:
    """Stands in for the repository. Remembers what was committed, so the test can look at
    the file that would really have been written."""

    def __init__(self, published=None, sha="sha-1"):
        self.published = published
        self.sha = sha
        self.commits = []

    def __call__(self, request):
        if request.method == "GET":
            if self.published is None:
                from urllib.error import HTTPError
                raise HTTPError(request.full_url, 404, "Not Found", {}, None)
            content = base64.b64encode(json.dumps(self.published).encode("utf-8")).decode("ascii")
            return FakeResponse(200, {"content": content, "sha": self.sha})
        body = json.loads(request.data.decode("utf-8"))
        self.commits.append(body)
        self.published = json.loads(base64.b64decode(body["content"]).decode("utf-8"))
        return FakeResponse(200, {"content": {}})


def sheet(sheet_id, season, year, created, linked=None, weeks=1):
    made = {
        "id": sheet_id, "season": season, "hebrewYear": year, "createdAt": created,
        "weeks": [{"serial": 46000 + i, "date": "2026-01-01T00:00:00.000Z", "parsha": "x", "specialParsha": ""} for i in range(weeks)],
        "pageSizes": [weeks], "overrides": {},
    }
    if linked:
        made["linkedSheetId"] = linked
    return made


STATE = {
    "settings": {"footerAddress": "44 Coles Way"},
    "rules": [{"id": "r1", "enabled": True}],
    "sheets": [
        sheet("k1", "kayitz", 5786, "2026-01-01T00:00:00.000Z"),
        sheet("k1w", "weekday", 5786, "2026-01-01T00:00:00.000Z", linked="k1"),
        sheet("c1", "choref", 5787, "2026-02-01T00:00:00.000Z"),
        sheet("c1w", "weekday", 5787, "2026-02-01T00:00:00.000Z", linked="c1"),
    ],
}

# --- what gets published --------------------------------------------------------------------
payload = publishlib.build_payload(STATE, STATE["sheets"], now="2026-08-19T00:00:00.000Z")
R.equal("the payload carries the settings", STATE["settings"], payload["settings"])
R.equal("and the rules, so the page applies them the same way", STATE["rules"], payload["rules"])
R.equal("and every sheet whole", 4, len(payload["sheets"]))
R.equal("with createdAt, which the page sorts on", "2026-02-01T00:00:00.000Z",
        next(s["createdAt"] for s in payload["sheets"] if s["id"] == "c1"))
R.expect("and nothing else on a sheet",
         set(payload["sheets"][0]) == {"id", "season", "hebrewYear", "createdAt", "weeks", "pageSizes", "overrides"},
         ", ".join(sorted(payload["sheets"][0])))
R.expect("a weekday chart names the sheet it belongs to", "linkedSheetId" in payload["sheets"][1], "")

groups = publishlib.publishable_groups(STATE)
R.equal("a season is offered with its weekday chart, newest first",
        [("c1", "c1w"), ("k1", "k1w")], [(s["id"], w["id"] if w else None) for s, w in groups])

# --- the merge -------------------------------------------------------------------------------
# A year needs both קיץ and חורף, so publishing one must never take the other down.
fake = FakeGitHub(published={"version": 1, "sheets": [
    sheet("k1", "kayitz", 5786, "2026-01-01T00:00:00.000Z"),
    sheet("k1w", "weekday", 5786, "2026-01-01T00:00:00.000Z", linked="k1"),
]})
publishlib.publish(STATE, [STATE["sheets"][2], STATE["sheets"][3]], "token", opener=fake)
written = fake.published["sheets"]
R.equal("publishing חורף leaves קיץ where it was",
        ["k1", "k1w", "c1", "c1w"], [s["id"] for s in written])

# Publishing the same season again replaces it, which is how a correction gets out.
again = [sheet("c2", "choref", 5787, "2026-03-01T00:00:00.000Z"),
         sheet("c2w", "weekday", 5787, "2026-03-01T00:00:00.000Z", linked="c2")]
publishlib.publish({**STATE, "sheets": again}, again, "token", opener=fake)
R.equal("publishing the same season again replaces it",
        ["k1", "k1w", "c2", "c2w"], [s["id"] for s in fake.published["sheets"]])

# The weekday charts all carry season "weekday", so comparing those by season and year would
# match קיץ's against חורף's and quietly delete one.
R.expect("and the other season's weekday chart survives",
         any(s["id"] == "k1w" for s in fake.published["sheets"]), "")

# --- taking one down ---------------------------------------------------------------------------
left = publishlib.unpublish({"id": "k1", "season": "kayitz", "hebrewYear": 5786}, "token", opener=fake)
R.equal("taking a season down takes its weekday chart with it",
        ["c2", "c2w"], [s["id"] for s in fake.published["sheets"]])
R.equal("and says how many are left", 1, left)

# --- nothing published yet -----------------------------------------------------------------------
empty = FakeGitHub(published=None)
data, sha = publishlib.fetch_published("token", opener=empty)
R.equal("nothing published yet is not an error", (None, None), (data, sha))
publishlib.publish(STATE, [STATE["sheets"][0], STATE["sheets"][1]], "token", opener=empty)
R.equal("and the first publish creates the file", ["k1", "k1w"], [s["id"] for s in empty.published["sheets"]])
R.expect("committed without a sha, since there was no file to replace",
         "sha" not in empty.commits[0], ", ".join(sorted(empty.commits[0])))
R.expect("with a message naming the season", "kayitz 5786" in empty.commits[0]["message"], empty.commits[0]["message"])

# --- what goes wrong ------------------------------------------------------------------------------
def refuses(status):
    class Refuser:
        def __call__(self, request):
            from urllib.error import HTTPError
            raise HTTPError(request.full_url, status, "no", {}, None)
    return Refuser()


for status, expected in ((401, "refused"), (403, "not allowed")):
    try:
        publishlib.fetch_published("token", opener=refuses(status))
        R.expect(f"a {status} is reported in words", False, "no error raised")
    except publishlib.PublishError as err:
        R.expect(f"a {status} is reported in words", expected in str(err), str(err))

try:
    publishlib.fetch_published("")
    R.expect("no token is reported in words", False, "no error raised")
except publishlib.PublishError as err:
    R.expect("no token is reported in words", "No publishing token" in str(err), str(err))

# --- the token stays out of a backup -----------------------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp)
    publishlib.write_token(folder, "  secret-token  ")
    R.equal("a token is saved trimmed", "secret-token", publishlib.read_token(folder))
    R.expect("in its own file", (folder / publishlib.TOKEN_FILE).exists(), publishlib.TOKEN_FILE)

    from zmanimboard import state as statelib
    backup = statelib.to_json(statelib.default_state())
    R.expect("and never appears in a backup", "secret-token" not in backup, "")

    publishlib.write_token(folder, "")
    R.equal("clearing it removes the file", "", publishlib.read_token(folder))
    R.expect("really removes it", not (folder / publishlib.TOKEN_FILE).exists(), "")

# --- interchangeable with the website's own file ---------------------------------------------------
# The congregation's page reads whatever is at data/published.json, whichever program wrote
# it. So the file this one would write has to have the same shape as the one already there.
from zmanimboard import state as state_mod  # noqa: E402

real = json.loads((ROOT / "data" / "published.json").read_text(encoding="utf-8"))
imported = state_mod.from_json(json.dumps(real))
rebuilt = publishlib.build_payload(imported, imported["sheets"], now=real["publishedAt"])

R.equal("the same top level keys", sorted(real), sorted(rebuilt))
R.equal("the same keys on a sheet", sorted(real["sheets"][0]), sorted(rebuilt["sheets"][0]))
R.equal("the same sheets, in the same order", [s["id"] for s in real["sheets"]], [s["id"] for s in rebuilt["sheets"]])
R.equal("the same weeks on the first sheet", real["sheets"][0]["weeks"], rebuilt["sheets"][0]["weeks"])
R.equal("and the same hand typed cells",
        [s.get("overrides") for s in real["sheets"]], [s.get("overrides") for s in rebuilt["sheets"]])

sys.exit(0 if R.summary() else 1)
