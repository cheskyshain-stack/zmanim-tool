"""The Yeshivish dictionary.

SQLite rather than a JSON file, because the brief asks for thousands of terms
now and a very large Torah vocabulary later. A JSON file that has to be parsed
and re-written whole starts to hurt in the tens of thousands; a database with an
index does not, and full text search stays instant.

The shape of an entry is what makes correction safe:

* ``canonical`` is the Mode A form, ``hebrew`` the Mode B form.
* Each ``Variant`` is one way the term gets written or misheard, with its own
  risk level and context rules.
* ``risk`` marks a variant that is also an ordinary English word. Those never
  fire without supporting context, which is what stops "camera" turning into
  Gemara in a sentence about a photograph.

Import and export are CSV, JSON and JSONL, so a vocabulary can be built up in a
spreadsheet and brought in.
"""

from __future__ import annotations

import csv
import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator

from ..core.logging import get
from . import phonetics
from .normalize import normalize, tokenize

log = get(__name__)

SAFE, RISKY = "safe", "risky"
HEARD, SPELLING = "heard", "spelling"

CATEGORIES = [
    "sefer", "masechta", "rav", "term", "halacha", "tefillah", "yomtov", "other",
]

# Variants that are also ordinary English words. Kept deliberately small and
# focused on the collisions that actually happen in Torah transcription, rather
# than a full English dictionary: a user can mark anything risky by hand, and a
# short honest list beats a long list that is wrong in surprising places.
#
# A word only belongs here if it is English with a DIFFERENT meaning. Putting a
# transliteration in it (brocha, torah, kosher, seder, amen were all in here
# once) makes Ksav demand context before correcting a word that was never
# ambiguous. test_lexicon.py checks the seed dictionary for exactly that.
COMMON_ENGLISH = {
    "camera", "cameras", "shiver", "shivers", "silver", "solver", "sever", "severe",
    "machine", "mission", "session", "passion", "fashion", "cushion", "caution",
    "cash", "cashew", "catch", "casher", "kosher", "closure", "clash", "crash",
    "mesh", "marsh", "harsh", "shore", "sure", "shower", "showers", "chore",
    "tour", "tore", "toss", "tossed", "cost", "coast", "coat",
    "raw", "rob", "robber", "rubber", "rub", "rev", "revere", "river", "rivers",
    "hand", "handle", "candle", "kindle", "middle", "medal", "model", "modal",
    "sugar", "soggy", "saga", "sago", "salt", "sold", "solid", "salad",
    "brochure", "broker", "broke", "block", "black", "blocks",
    "master", "mister", "monster", "minister", "measure", "mixture",
    "party", "pastry", "posture", "pasture", "poster", "pester",
    "tell", "till", "tall", "toll", "tool", "teal", "tale", "tail",
    "din", "dine", "dean", "den", "dawn", "down", "done", "dune",
    "gets", "guts", "gate", "goat", "got", "get", "gut",
    "shy", "she", "shed", "shell", "shall",
    "lay", "lie", "lea", "lee", "law", "low", "loch", "lock",
    "omen", "common", "comment", "amount", "moment",
    "ohms", "arms", "alms", "almost", "psalms",
    "cedar", "cider", "sadder",
    "meal", "mill", "mall", "mule", "male", "mail",
    "hey", "hay", "high", "hi", "he", "her", "here", "hear",
    "nay", "neigh", "knee", "near", "nice", "niece",
    "bore", "boar", "bar", "bear", "bare", "beer", "bird",
    "chase", "chess", "chest", "chased", "chosen", "chasing",
    "sold", "soul", "sole", "seal", "sell", "sale", "sail",
    "part", "port", "pert", "peer", "pier", "pear", "pair",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Variant:
    """One way a term is written or misheard."""

    text: str
    kind: str = SPELLING            # heard (a recognition mistake) or spelling
    risk: str = SAFE                # safe or risky
    requires_context: list[str] = field(default_factory=list)
    blocked_by: list[str] = field(default_factory=list)
    confidence: float = 1.0
    id: int | None = None

    @property
    def norm(self) -> str:
        """The lookup key: normalised tokens joined by single spaces."""
        return " ".join(t.norm for t in tokenize(self.text)) or normalize(self.text)

    @property
    def token_count(self) -> int:
        return max(1, len(self.norm.split()))

    def auto_risk(self) -> str:
        """Risky if the variant is a word an English sentence could contain."""
        if self.risk == RISKY:
            return RISKY
        return RISKY if self.norm in COMMON_ENGLISH else SAFE


@dataclass
class Entry:
    """One term, its canonical spellings, and every way it might come out."""

    canonical: str
    hebrew: str | None = None
    category: str = "term"
    prefer_hebrew: bool = False     # Mode C hint for this specific term
    enabled: bool = True
    source: str = "user"            # builtin, user or import
    notes: str = ""
    variants: list[Variant] = field(default_factory=list)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    def all_forms(self) -> list[str]:
        """Everything that should match this entry, canonical included."""
        forms = [self.canonical]
        if self.hebrew:
            forms.append(self.hebrew)
        forms.extend(v.text for v in self.variants)
        return forms

    def to_row(self) -> dict:
        return {
            "canonical": self.canonical,
            "hebrew": self.hebrew or "",
            "category": self.category,
            "prefer_hebrew": self.prefer_hebrew,
            "notes": self.notes,
            "variants": [
                {
                    "text": v.text,
                    "kind": v.kind,
                    "risk": v.risk,
                    "requires_context": v.requires_context,
                    "blocked_by": v.blocked_by,
                    "confidence": v.confidence,
                }
                for v in self.variants
            ],
        }

    @classmethod
    def from_row(cls, row: dict, source: str = "import") -> "Entry":
        """Build from an imported dict, tolerating the shapes people actually write."""
        variants: list[Variant] = []
        raw = row.get("variants") or row.get("heard_as") or row.get("heard as") or []
        if isinstance(raw, str):
            # A spreadsheet column: "camera; gemorah; gmara"
            raw = [v.strip() for v in raw.replace(",", ";").split(";") if v.strip()]
        for item in raw:
            if isinstance(item, str):
                variants.append(Variant(item))
            elif isinstance(item, dict):
                variants.append(Variant(
                    text=item.get("text", ""),
                    kind=item.get("kind", SPELLING),
                    risk=item.get("risk", SAFE),
                    requires_context=list(item.get("requires_context") or []),
                    blocked_by=list(item.get("blocked_by") or []),
                    confidence=float(item.get("confidence", 1.0)),
                ))
        return cls(
            canonical=(row.get("canonical") or row.get("correct_to")
                       or row.get("correct to") or row.get("term") or "").strip(),
            hebrew=(row.get("hebrew") or "").strip() or None,
            category=(row.get("category") or "term").strip(),
            prefer_hebrew=_truthy(row.get("prefer_hebrew")),
            notes=(row.get("notes") or "").strip(),
            variants=[v for v in variants if v.text.strip()],
            source=source,
        )


def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id            TEXT PRIMARY KEY,
    canonical     TEXT NOT NULL,
    hebrew        TEXT,
    category      TEXT NOT NULL DEFAULT 'term',
    prefer_hebrew INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    source        TEXT NOT NULL DEFAULT 'user',
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id         TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    text             TEXT NOT NULL,
    norm             TEXT NOT NULL,
    token_count      INTEGER NOT NULL DEFAULT 1,
    phonetic         TEXT NOT NULL DEFAULT '',
    kind             TEXT NOT NULL DEFAULT 'spelling',
    risk             TEXT NOT NULL DEFAULT 'safe',
    requires_context TEXT NOT NULL DEFAULT '[]',
    blocked_by       TEXT NOT NULL DEFAULT '[]',
    confidence       REAL NOT NULL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS variants_norm ON variants(norm);
CREATE INDEX IF NOT EXISTS variants_entry ON variants(entry_id);
CREATE INDEX IF NOT EXISTS variants_phonetic ON variants(phonetic);
CREATE INDEX IF NOT EXISTS entries_canonical ON entries(canonical COLLATE NOCASE);
"""

FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    entry_id UNINDEXED, canonical, hebrew, forms, tokenize='unicode61'
);
"""


class Lexicon:
    """The dictionary, on disk.

    Opened once and kept. Every write updates the search index in the same
    transaction, so a crash cannot leave the two out of step.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(self.path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.executescript(SCHEMA)
        self.has_fts = self._try_fts()
        self._db.commit()

    def _try_fts(self) -> bool:
        """FTS5 is compiled into most SQLite builds but not all.

        Without it search falls back to LIKE, which is slower on a very large
        vocabulary but correct. Better than refusing to open the dictionary.
        """
        try:
            self._db.executescript(FTS_SCHEMA)
            return True
        except sqlite3.OperationalError as exc:
            log.warning("FTS5 unavailable, falling back to LIKE search: %s", exc)
            return False

    def close(self) -> None:
        self._db.close()

    # -- writing ---------------------------------------------------------

    def add(self, entry: Entry) -> Entry:
        entry.updated_at = _now()
        with self._db:
            self._db.execute(
                "INSERT OR REPLACE INTO entries "
                "(id, canonical, hebrew, category, prefer_hebrew, enabled, source, "
                " notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (entry.id, entry.canonical, entry.hebrew, entry.category,
                 int(entry.prefer_hebrew), int(entry.enabled), entry.source,
                 entry.notes, entry.created_at, entry.updated_at),
            )
            self._db.execute("DELETE FROM variants WHERE entry_id = ?", (entry.id,))
            for variant in entry.variants:
                self._db.execute(
                    "INSERT INTO variants (entry_id, text, norm, token_count, phonetic, "
                    "kind, risk, requires_context, blocked_by, confidence) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (entry.id, variant.text, variant.norm, variant.token_count,
                     " ".join(sorted(phonetics.keys(variant.text))),
                     variant.kind, variant.auto_risk(),
                     json.dumps(variant.requires_context),
                     json.dumps(variant.blocked_by), variant.confidence),
                )
            self._reindex(entry)
        return entry

    def update(self, entry: Entry) -> Entry:
        return self.add(entry)

    def delete(self, entry_id: str) -> None:
        with self._db:
            self._db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
            if self.has_fts:
                self._db.execute("DELETE FROM entries_fts WHERE entry_id = ?", (entry_id,))

    def set_enabled(self, entry_id: str, enabled: bool) -> None:
        with self._db:
            self._db.execute(
                "UPDATE entries SET enabled = ?, updated_at = ? WHERE id = ?",
                (int(enabled), _now(), entry_id),
            )

    def _reindex(self, entry: Entry) -> None:
        if not self.has_fts:
            return
        self._db.execute("DELETE FROM entries_fts WHERE entry_id = ?", (entry.id,))
        self._db.execute(
            "INSERT INTO entries_fts (entry_id, canonical, hebrew, forms) VALUES (?,?,?,?)",
            (entry.id, entry.canonical, entry.hebrew or "",
             " ".join(v.text for v in entry.variants)),
        )

    # -- reading ---------------------------------------------------------

    def get(self, entry_id: str) -> Entry | None:
        row = self._db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
        return self._build(row) if row else None

    def count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM entries").fetchone()[0]

    def variant_count(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM variants").fetchone()[0]

    def all(self, limit: int = 0, offset: int = 0) -> list[Entry]:
        sql = "SELECT * FROM entries ORDER BY canonical COLLATE NOCASE"
        if limit:
            sql += f" LIMIT {int(limit)} OFFSET {int(offset)}"
        return [self._build(r) for r in self._db.execute(sql)]

    def search(self, query: str, limit: int = 200) -> list[Entry]:
        """Find by canonical form, Hebrew form, or any variant."""
        query = (query or "").strip()
        if not query:
            return self.all(limit=limit)

        if self.has_fts:
            try:
                rows = self._db.execute(
                    "SELECT e.* FROM entries_fts f JOIN entries e ON e.id = f.entry_id "
                    "WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?",
                    (self._fts_query(query), limit),
                ).fetchall()
                return [self._build(r) for r in rows]
            except sqlite3.OperationalError:
                pass          # a query FTS cannot parse, fall through to LIKE

        pattern = f"%{query}%"
        rows = self._db.execute(
            "SELECT DISTINCT e.* FROM entries e "
            "LEFT JOIN variants v ON v.entry_id = e.id "
            "WHERE e.canonical LIKE ? OR e.hebrew LIKE ? OR v.text LIKE ? "
            "ORDER BY e.canonical COLLATE NOCASE LIMIT ?",
            (pattern, pattern, pattern, limit),
        ).fetchall()
        return [self._build(r) for r in rows]

    @staticmethod
    def _fts_query(query: str) -> str:
        """Prefix match on each word, with anything FTS treats as syntax removed."""
        words = [w for w in tokenize(query)]
        if not words:
            return '""'
        return " ".join(f'"{w.text}"*' for w in words)

    def _build(self, row: sqlite3.Row) -> Entry:
        variants = [
            Variant(
                text=v["text"],
                kind=v["kind"],
                risk=v["risk"],
                requires_context=json.loads(v["requires_context"]),
                blocked_by=json.loads(v["blocked_by"]),
                confidence=v["confidence"],
                id=v["id"],
            )
            for v in self._db.execute(
                "SELECT * FROM variants WHERE entry_id = ? ORDER BY id", (row["id"],)
            )
        ]
        return Entry(
            id=row["id"],
            canonical=row["canonical"],
            hebrew=row["hebrew"],
            category=row["category"],
            prefer_hebrew=bool(row["prefer_hebrew"]),
            enabled=bool(row["enabled"]),
            source=row["source"],
            notes=row["notes"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            variants=variants,
        )

    # -- what the matcher needs -----------------------------------------

    def match_rows(self) -> Iterator[sqlite3.Row]:
        """Every enabled variant, joined to its entry. Feeds the matcher index."""
        return self._db.execute(
            "SELECT v.norm, v.token_count, v.phonetic, v.kind, v.risk, "
            "       v.requires_context, v.blocked_by, v.confidence, "
            "       e.id AS entry_id, e.canonical, e.hebrew, e.category, e.prefer_hebrew "
            "FROM variants v JOIN entries e ON e.id = v.entry_id "
            "WHERE e.enabled = 1"
        )

    def canonical_rows(self) -> Iterator[sqlite3.Row]:
        """Every enabled entry's own canonical and Hebrew forms.

        A term written correctly still needs to be recognised, so that Mode B can
        put it into Hebrew and Mode C can decide. Without this, only misspellings
        would be annotated.
        """
        return self._db.execute(
            "SELECT id AS entry_id, canonical, hebrew, category, prefer_hebrew "
            "FROM entries WHERE enabled = 1"
        )

    def priming_terms(self, limit: int = 60) -> list[str]:
        """Terms worth sending to the recogniser before it decides on a word.

        Whisper's prompt is capped at roughly 224 tokens, so this is a ranked
        selection rather than the whole vocabulary: the shortest canonical forms
        from the categories that carry the most weight.
        """
        # Ranked by what actually helps recognition, not by what is shortest.
        # Sorting by length first put obscure three letter masechtos ahead of
        # Gemara and kashya, which is exactly backwards. Variant count is the
        # best signal available without usage data: a term somebody took the
        # trouble to give six spellings to is a term that comes up.
        rows = self._db.execute(
            "SELECT e.canonical, COUNT(v.id) AS variants FROM entries e "
            "LEFT JOIN variants v ON v.entry_id = e.id "
            "WHERE e.enabled = 1 GROUP BY e.id "
            "ORDER BY CASE e.category "
            "  WHEN 'term' THEN 0 WHEN 'sefer' THEN 1 WHEN 'rav' THEN 2 "
            "  WHEN 'halacha' THEN 3 WHEN 'masechta' THEN 4 ELSE 5 END, "
            "  variants DESC, LENGTH(e.canonical) LIMIT ?",
            (limit,),
        )
        return [r["canonical"] for r in rows]

    # -- import and export ----------------------------------------------

    def import_rows(self, rows: Iterable[dict], source: str = "import") -> tuple[int, int]:
        """Add or merge entries. Returns (added, merged).

        Merging by canonical form rather than creating a duplicate is what makes
        it safe to import the same list twice, which people do.
        """
        added = merged = 0
        for row in rows:
            entry = Entry.from_row(row, source=source)
            if not entry.canonical:
                continue
            existing = self._by_canonical(entry.canonical)
            if existing:
                known = {v.norm for v in existing.variants}
                for variant in entry.variants:
                    if variant.norm not in known:
                        existing.variants.append(variant)
                        known.add(variant.norm)
                existing.hebrew = existing.hebrew or entry.hebrew
                existing.notes = existing.notes or entry.notes
                self.add(existing)
                merged += 1
            else:
                self.add(entry)
                added += 1
        return added, merged

    def _by_canonical(self, canonical: str) -> Entry | None:
        row = self._db.execute(
            "SELECT * FROM entries WHERE canonical = ? COLLATE NOCASE", (canonical,)
        ).fetchone()
        return self._build(row) if row else None

    def import_file(self, path: Path | str, source: str = "import") -> tuple[int, int]:
        """Read CSV, JSON or JSONL. The extension decides, the content confirms."""
        path = Path(path)
        text = path.read_text(encoding="utf-8-sig")
        suffix = path.suffix.lower()

        if suffix in (".jsonl", ".ndjson"):
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        elif suffix == ".json":
            data = json.loads(text)
            rows = data if isinstance(data, list) else data.get("entries", [])
        elif suffix in (".csv", ".tsv", ".txt"):
            delimiter = "\t" if suffix == ".tsv" else ","
            reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
            rows = [{(k or "").strip().lower(): v for k, v in r.items()} for r in reader]
        else:
            raise ValueError(
                f"Ksav can read .csv, .tsv, .json and .jsonl dictionaries. "
                f"It does not know what to do with a {suffix or 'file with no'} extension."
            )
        return self.import_rows(rows, source=source)

    def export_file(self, path: Path | str) -> int:
        """Write the whole dictionary. JSONL by default, CSV when asked for."""
        path = Path(path)
        entries = self.all()
        if path.suffix.lower() == ".csv":
            with open(path, "w", encoding="utf-8-sig", newline="") as fh:
                writer = csv.writer(fh)
                writer.writerow(["canonical", "hebrew", "category", "prefer_hebrew",
                                 "heard_as", "notes"])
                for entry in entries:
                    writer.writerow([
                        entry.canonical, entry.hebrew or "", entry.category,
                        "yes" if entry.prefer_hebrew else "",
                        "; ".join(v.text for v in entry.variants), entry.notes,
                    ])
        else:
            with open(path, "w", encoding="utf-8") as fh:
                for entry in entries:
                    fh.write(json.dumps(entry.to_row(), ensure_ascii=False) + "\n")
        return len(entries)

    def seed_from(self, path: Path | str) -> int:
        """Load the shipped vocabulary into an empty dictionary.

        Only into an empty one. A user who deleted a seeded term should not find
        it back on the next launch.
        """
        if self.count():
            return 0
        added, _ = self.import_rows(
            (json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines()
             if line.strip()),
            source="builtin",
        )
        return added
