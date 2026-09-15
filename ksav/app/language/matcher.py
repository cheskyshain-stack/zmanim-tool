"""Finding dictionary terms in a transcript, quickly and with word boundaries.

The design note said Aho-Corasick. Building it, an n-gram index turned out to be
the better answer for this particular problem and it is worth saying why rather
than quietly substituting one for the other.

Aho-Corasick earns its complexity when patterns are character sequences of
unbounded length. Here the patterns are runs of whole words, and no Torah term
is longer than a handful of them. Indexing every term by its normalised token
run and then looking up at most six slices at each position is the same linear
cost in the length of the transcript, builds in a fraction of the time, uses less
memory, needs no compiled dependency, and can be read by anyone. Matching is on
tokens throughout, so word boundaries are structural rather than a regex that has
to be got right.

The index is built once from the dictionary and reused. Rebuilding is cheap
enough that a dictionary edit simply invalidates it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from . import phonetics
from .normalize import Token, tokenize

if TYPE_CHECKING:
    from .lexicon import Lexicon

# No Torah term in practice runs longer than this many words. Raising it costs
# a lookup per token per extra word, so it is a real ceiling rather than a guess.
MAX_PHRASE_TOKENS = 6


@dataclass(frozen=True)
class Rule:
    """One thing to look for, and everything needed to decide whether to act."""

    entry_id: str
    canonical: str
    hebrew: str | None
    category: str
    prefer_hebrew: bool
    kind: str                       # heard, spelling or canonical
    risk: str                       # safe or risky
    requires_context: tuple[str, ...] = ()
    blocked_by: tuple[str, ...] = ()
    confidence: float = 1.0
    token_count: int = 1


@dataclass
class RawMatch:
    """A rule that fired at a place in the text, before any gating."""

    rule: Rule
    first: int                      # index of the first token
    last: int                       # index of the last token
    start: int                      # character offset into the source string
    end: int
    raw: str
    phonetic: bool = False
    similarity: float = 1.0


class Index:
    """The built dictionary, ready to match against."""

    def __init__(self) -> None:
        self.by_ngram: dict[str, list[Rule]] = {}
        self.by_phonetic: dict[str, list[Rule]] = {}
        self.max_tokens = 1

    # -- building --------------------------------------------------------

    def add(self, key: str, rule: Rule) -> None:
        if not key:
            return
        self.by_ngram.setdefault(key, []).append(rule)
        self.max_tokens = max(self.max_tokens, min(rule.token_count, MAX_PHRASE_TOKENS))

    def add_phonetic(self, keys: set[str], rule: Rule) -> None:
        for key in keys:
            if key:
                self.by_phonetic.setdefault(key, []).append(rule)

    @property
    def size(self) -> int:
        return len(self.by_ngram)

    # -- matching --------------------------------------------------------

    def find(self, text: str, allow_phonetic: bool = True) -> list[RawMatch]:
        """Every non overlapping match, longest first at each position.

        Longest first is what makes ``Bava Metzia`` win over ``Bava``, and
        ``Shulchan Aruch`` win over neither half on its own.
        """
        tokens = tokenize(text)
        matches: list[RawMatch] = []
        position = 0

        while position < len(tokens):
            hit = self._at(tokens, position)
            if hit is None and allow_phonetic:
                hit = self._phonetic_at(tokens, position)
            if hit is None:
                position += 1
                continue
            matches.append(hit)
            position = hit.last + 1

        return matches

    def _at(self, tokens: list[Token], position: int) -> RawMatch | None:
        limit = min(self.max_tokens, len(tokens) - position)
        for length in range(limit, 0, -1):
            key = " ".join(tokens[position + i].norm for i in range(length))
            rules = self.by_ngram.get(key)
            if not rules:
                continue
            first, last = tokens[position], tokens[position + length - 1]
            return RawMatch(
                rule=self._best(rules),
                first=position,
                last=position + length - 1,
                start=first.start,
                end=last.end,
                raw=self._source_span(tokens, position, length),
            )
        return None

    def _phonetic_at(self, tokens: list[Token], position: int) -> RawMatch | None:
        """A single word that sounds like a term nobody has entered yet.

        Only ever a suggestion. The key is coarse, so the raw spelling has to be
        close as well before this is offered at all.
        """
        token = tokens[position]
        if len(token.norm) < 4:
            return None            # too short to say anything useful about
        candidates: list[tuple[float, Rule]] = []
        for key in phonetics.keys(token.text):
            for rule in self.by_phonetic.get(key, ()):
                score = phonetics.similarity(token.text, rule.canonical)
                if score >= 0.6:
                    candidates.append((score, rule))
        if not candidates:
            return None
        score, rule = max(candidates, key=lambda pair: pair[0])
        return RawMatch(
            rule=rule,
            first=position,
            last=position,
            start=token.start,
            end=token.end,
            raw=token.text,
            phonetic=True,
            similarity=score,
        )

    @staticmethod
    def _source_span(tokens: list[Token], position: int, length: int) -> str:
        return " ".join(tokens[position + i].text for i in range(length))

    @staticmethod
    def _best(rules: list[Rule]) -> Rule:
        """When two entries claim the same words, prefer the safer, surer one."""
        return max(rules, key=lambda r: (r.risk == "safe", r.confidence, r.kind == "canonical"))


def build(lexicon: "Lexicon") -> Index:
    """Build the index from the dictionary. Cheap enough to redo after an edit."""
    index = Index()

    for row in lexicon.match_rows():
        rule = Rule(
            entry_id=row["entry_id"],
            canonical=row["canonical"],
            hebrew=row["hebrew"],
            category=row["category"],
            prefer_hebrew=bool(row["prefer_hebrew"]),
            kind=row["kind"],
            risk=row["risk"],
            requires_context=tuple(json.loads(row["requires_context"])),
            blocked_by=tuple(json.loads(row["blocked_by"])),
            confidence=row["confidence"],
            token_count=row["token_count"],
        )
        index.add(row["norm"], rule)
        if row["phonetic"]:
            index.add_phonetic(set(row["phonetic"].split()), rule)

    # A term spelled correctly still has to be recognised, or Mode B would have
    # nothing to put into Hebrew and only mistakes would ever be annotated.
    for row in lexicon.canonical_rows():
        for form in (row["canonical"], row["hebrew"]):
            if not form:
                continue
            key = " ".join(t.norm for t in tokenize(form))
            rule = Rule(
                entry_id=row["entry_id"],
                canonical=row["canonical"],
                hebrew=row["hebrew"],
                category=row["category"],
                prefer_hebrew=bool(row["prefer_hebrew"]),
                kind="canonical",
                risk="safe",
                confidence=1.0,
                token_count=max(1, len(key.split())),
            )
            index.add(key, rule)
            index.add_phonetic(phonetics.keys(row["canonical"]), rule)

    return index
