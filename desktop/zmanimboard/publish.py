"""Publishing a season for the congregation.

The congregation's page is a static site, so publishing means committing one file to the
repository behind it: data/published.json. That is the whole mechanism. No backend, no
login, no database, and nothing here needs any software beyond this program: it is one
HTTPS call to GitHub's own API.

The token is kept in its own file rather than in the state, so it can never ride along in an
exported backup. A backup gets shared; a write token must not.
"""
import base64
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_OWNER = "cheskyshain-stack"
REPO_NAME = "zmanim-tool"
REPO_BRANCH = "main"
PUBLISH_PATH = "data/published.json"
TOKEN_FILE = "publish-token.txt"
API = "https://api.github.com"


class PublishError(Exception):
    """Something the person can act on, said in words rather than as a status code."""


# --- the token --------------------------------------------------------------------------
def read_token(folder: Path) -> str:
    try:
        return (Path(folder) / TOKEN_FILE).read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""


def write_token(folder: Path, token: str) -> None:
    path = Path(folder) / TOKEN_FILE
    if token.strip():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token.strip(), encoding="utf-8")
    elif path.exists():
        path.unlink()


# --- what gets published ------------------------------------------------------------------
def build_payload(state: dict, sheets: list, now: str | None = None) -> dict:
    """What the congregation's page needs, and nothing else.

    The sheets go whole, weeks and overrides included, rather than as times worked out in
    advance: the page runs the same code this program does, so a hand typed cell or a rule
    shows up there exactly as it does here. Rules travel for the same reason.
    """
    def one(s: dict) -> dict:
        out = {
            "id": s["id"],
            "season": s["season"],
            "hebrewYear": s["hebrewYear"],
            # Carried because the page sorts on it: where two published sheets both cover a
            # week, the most recently generated one wins. Left out, they all sort the same
            # and the winner comes down to the order they happened to be published in, which
            # is not a rule anyone could predict.
            "createdAt": s.get("createdAt"),
        }
        # Written only when there is one, which is what the website's own file does:
        # JSON.stringify drops a key whose value is undefined. Writing null instead would
        # show up as a change on every single publish and make the real ones hard to see.
        if s.get("linkedSheetId"):
            out["linkedSheetId"] = s["linkedSheetId"]
        out["weeks"] = s["weeks"]
        out["pageSizes"] = s["pageSizes"]
        out["overrides"] = s.get("overrides") or {}
        return out

    return {
        "version": 1,
        "publishedAt": now or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "settings": state["settings"],
        "rules": state.get("rules") or [],
        "sheets": [one(s) for s in sheets],
    }


def publishable_groups(state: dict) -> list:
    """The Shabbos sheets worth publishing, newest first, each with its weekday companion."""
    shabbos = [s for s in state.get("sheets") or [] if s["season"] != "weekday"]
    shabbos.sort(key=lambda s: str(s.get("createdAt") or ""), reverse=True)
    out = []
    for sheet in shabbos:
        weekday = next((s for s in state["sheets"] if s["season"] == "weekday" and s.get("linkedSheetId") == sheet["id"]), None)
        out.append((sheet, weekday))
    return out


def _same_season(a: dict, b: dict) -> bool:
    return a["season"] == b["season"] and a["hebrewYear"] == b["hebrewYear"]


def merge(existing: list, incoming: list) -> list:
    """A season replaces the same season, and leaves every other one alone.

    A year needs both קיץ and חורף, so publishing one must not take the other down. Only the
    entry for the same season and year is replaced, which is what makes a corrected chart
    supersede the one before it.

    Only Shabbos sheets identify a season. Every weekday chart carries season "weekday", so
    comparing those the same way matched קיץ's weekday chart against חורף's and quietly
    deleted one: a weekday chart belongs to whichever Shabbos sheet it was generated with,
    and goes only when that sheet does.
    """
    incoming_seasons = [s for s in incoming if s["season"] != "weekday"]
    replaced = {
        s["id"] for s in existing
        if s["season"] != "weekday" and any(_same_season(i, s) for i in incoming_seasons)
    }
    def keep(s: dict) -> bool:
        if s["season"] == "weekday":
            return s.get("linkedSheetId") not in replaced
        return not any(_same_season(i, s) for i in incoming_seasons)

    return [s for s in existing if keep(s)] + list(incoming)


def without_season(existing: list, sheet: dict) -> list:
    """One season taken back off, its weekday companion with it."""
    return [
        s for s in existing
        if not _same_season(s, sheet) and not (s["season"] == "weekday" and s.get("linkedSheetId") == sheet["id"])
    ]


# --- talking to GitHub -----------------------------------------------------------------------
def _request(path: str, token: str, method: str = "GET", body: dict | None = None, opener=None):
    request = urllib.request.Request(
        f"{API}/repos/{REPO_OWNER}/{REPO_NAME}/{path}",
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "ZmanimBoard",
        },
    )
    send = opener or urllib.request.urlopen
    try:
        with send(request) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read().decode("utf-8"))
        except (ValueError, OSError):
            detail = {}
        return err.code, detail
    except urllib.error.URLError as err:
        raise PublishError(f"Could not reach GitHub: {err.reason}. Check the internet connection.") from err


def fetch_published(token: str, opener=None):
    """Whatever is published right now, straight from the repository rather than from the
    deployed site, so it is accurate the moment after a publish instead of a minute later.
    Returns (data, sha), with data None when nothing is published yet."""
    if not token:
        raise PublishError("No publishing token set. Add one in Settings, under Publishing.")
    status, body = _request(f"contents/{PUBLISH_PATH}?ref={REPO_BRANCH}", token, opener=opener)
    if status == 404:
        return None, None
    if status == 401:
        raise PublishError("That token was refused. It may be wrong, expired, or revoked.")
    if status == 403:
        raise PublishError("That token is not allowed to read this repository.")
    if status >= 400:
        raise PublishError(f"GitHub replied {status} when reading what is published.")
    text = base64.b64decode(body["content"]).decode("utf-8")
    return json.loads(text), body["sha"]


def _commit(payload: dict, sha, message: str, token: str, opener=None):
    body = {
        "message": message,
        "content": base64.b64encode(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")).decode("ascii"),
        "branch": REPO_BRANCH,
    }
    if sha:
        body["sha"] = sha
    status, detail = _request(f"contents/{PUBLISH_PATH}", token, method="PUT", body=body, opener=opener)
    if status in (401, 403):
        raise PublishError("That token is not allowed to write to this repository.")
    if status >= 400:
        raise PublishError(f"GitHub refused the change ({status})" + (f": {detail.get('message')}" if detail.get("message") else "."))


def publish(state: dict, sheets: list, token: str, opener=None, now: str | None = None) -> str:
    """Publishes one season, keeping every other season already published."""
    existing, sha = fetch_published(token, opener=opener)
    payload = build_payload(state, sheets, now=now)
    payload["sheets"] = merge((existing or {}).get("sheets") or [], payload["sheets"])
    season = next((s for s in sheets if s["season"] != "weekday"), None)
    label = f'{season["season"]} {season["hebrewYear"]}' if season else "season"
    _commit(payload, sha, f"Publish {label}", token, opener=opener)
    return "updated" if existing else "created"


def unpublish(sheet: dict, token: str, opener=None) -> int:
    """Takes one season back off the congregation's page, leaving the others published."""
    existing, sha = fetch_published(token, opener=opener)
    if not existing:
        raise PublishError("Nothing is published.")
    remaining = without_season(existing.get("sheets") or [], sheet)
    payload = {**existing, "sheets": remaining}
    _commit(payload, sha, f'Unpublish {sheet["season"]} {sheet["hebrewYear"]}', token, opener=opener)
    return len([s for s in remaining if s["season"] != "weekday"])
