"""Deciding which matches to act on.

Finding a term is the easy half. This is the half that keeps Ksav from being a
dangerous global find and replace, and every rule here exists because of a way
that could go wrong:

* A variant that is also an ordinary English word does not fire unless a
  learning word is nearby. "The camera asks a kashya" becomes Gemara; "I took a
  photo with the camera" does not.
* A blocking word kills the match outright rather than demoting it, because a
  suggestion to turn a photograph into a Gemara is noise, not help.
* A phonetic hit is never applied on its own. The key is coarse by design, so it
  is offered for review.
* Everything carries its reason, so the corrections panel can explain itself and
  every change can be undone individually.

Nothing here edits the transcript. It produces annotations pointing at spans in
the engine's own output, which the renderer then reads. That is what makes Mode D
genuinely raw and mode switching free.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..core.models import Correction, CorrectionKind, Segment, Transcript
from .matcher import Index, RawMatch
from .normalize import tokenize

# How far either side of a match to look for a supporting or blocking word.
CONTEXT_WINDOW_TOKENS = 12

# What a risky match is worth once its context has been found. Below the user's
# threshold it becomes a suggestion rather than a change.
RISKY_WITH_CONTEXT = 0.85
RISKY_WITHOUT_CONTEXT = 0.35
PHONETIC_CEILING = 0.6      # deliberately below any sensible threshold


@dataclass
class Policy:
    """The user's settings, in the form this module needs them."""

    confidence_threshold: float = 0.75
    require_context_for_risky: bool = True
    enable_phonetic_suggestions: bool = True

    @classmethod
    def from_settings(cls, settings) -> "Policy":
        language = settings.language
        return cls(
            confidence_threshold=language.confidence_threshold,
            require_context_for_risky=language.require_context_for_risky,
            enable_phonetic_suggestions=language.enable_phonetic_suggestions,
        )


def correct(
    transcript: Transcript,
    index: Index,
    policy: Policy | None = None,
) -> list[Correction]:
    """Annotate a whole transcript. Returns corrections, applied and suggested."""
    policy = policy or Policy()
    out: list[Correction] = []
    for position, segment in enumerate(transcript.segments):
        context = _context_words(transcript.segments, position)
        for correction in correct_segment(segment, index, policy, context):
            # correct_segment does not know where it sits; only this loop does.
            correction.segment_index = position
            out.append(correction)
    return out


def correct_segment(
    segment: Segment,
    index: Index,
    policy: Policy | None = None,
    context: list[str] | None = None,
) -> list[Correction]:
    policy = policy or Policy()
    if context is None:
        context = [t.norm for t in tokenize(segment.text)]

    out: list[Correction] = []
    for match in index.find(segment.text, allow_phonetic=policy.enable_phonetic_suggestions):
        correction = _judge(match, segment, policy, context)
        if correction is not None:
            out.append(correction)
    return out


def _context_words(segments: list[Segment], position: int) -> list[str]:
    """The words around a segment, reaching into its neighbours.

    A shiur does not respect segment boundaries: "The Gemara" can end one
    segment and "asks a kashya" begin the next. Looking only inside the segment
    would lose the context that makes a risky match safe.
    """
    window = segments[max(0, position - 1):position + 2]
    words: list[str] = []
    for segment in window:
        words.extend(t.norm for t in tokenize(segment.text))
    return words


def _judge(
    match: RawMatch,
    segment: Segment,
    policy: Policy,
    context: list[str],
) -> Correction | None:
    rule = match.rule

    # A blocking word means this is not the term at all. Drop it entirely
    # rather than offering it, because a wrong suggestion is worse than silence.
    if rule.blocked_by and _nearby(context, rule.blocked_by, match.first):
        return None

    if match.phonetic:
        if not policy.enable_phonetic_suggestions:
            return None
        confidence = min(PHONETIC_CEILING, match.similarity)
        return _make(
            match, rule, confidence,
            kind=CorrectionKind.PHONETIC,
            reason=f"Sounds like {rule.canonical}. Not in the dictionary, so this is "
                   f"only a suggestion.",
            applied=False,
        )

    if rule.kind == "canonical":
        # Already written correctly. Annotated so Mode B and Mode C can act on
        # it, but it changes nothing in Mode A.
        return _make(
            match, rule, 1.0,
            kind=CorrectionKind.EXACT,
            reason=f"Recognised as {rule.canonical}.",
            applied=True,
        )

    if rule.risk == "risky" and policy.require_context_for_risky:
        supported = _nearby(context, rule.requires_context, match.first)
        if not supported:
            return _make(
                match, rule, RISKY_WITHOUT_CONTEXT,
                kind=CorrectionKind.EXACT,
                reason=f"'{match.raw}' can mean {rule.canonical}, but it is also an "
                       f"ordinary English word and nothing nearby suggests learning. "
                       f"Left alone.",
                applied=False,
            )
        confidence = max(RISKY_WITH_CONTEXT, rule.confidence * RISKY_WITH_CONTEXT)
        return _make(
            match, rule, confidence,
            kind=CorrectionKind.EXACT,
            reason=f"'{match.raw}' heard as {rule.canonical}, supported by "
                   f"'{supported}' nearby.",
            applied=confidence >= policy.confidence_threshold,
        )

    kind = CorrectionKind.SPELLING if rule.kind == "spelling" else CorrectionKind.EXACT
    verb = "spelling of" if rule.kind == "spelling" else "heard as"
    return _make(
        match, rule, rule.confidence,
        kind=kind,
        reason=f"'{match.raw}' is a known {verb} {rule.canonical}.",
        applied=rule.confidence >= policy.confidence_threshold,
    )


def _make(
    match: RawMatch,
    rule,
    confidence: float,
    *,
    kind: CorrectionKind,
    reason: str,
    applied: bool,
) -> Correction:
    return Correction(
        segment_index=-1,          # filled in by the caller that knows it
        start=match.start,
        end=match.end,
        raw=match.raw,
        entry_id=rule.entry_id,
        canonical=rule.canonical,
        hebrew=rule.hebrew,
        kind=kind,
        confidence=round(confidence, 3),
        reason=reason,
        applied=applied,
        prefer_hebrew=rule.prefer_hebrew,
    )


def _nearby(context: list[str], words: tuple[str, ...] | list[str], position: int) -> str | None:
    """The first of ``words`` found within the window. None when there is none."""
    if not words:
        return None
    wanted = {w.casefold() for w in words}
    low = max(0, position - CONTEXT_WINDOW_TOKENS)
    high = min(len(context), position + CONTEXT_WINDOW_TOKENS + 1)
    for word in context[low:high]:
        if word in wanted:
            return word
    # The window is measured in tokens of the surrounding text, which can be
    # offset from the segment's own numbering. Fall back to the whole context
    # rather than miss a supporting word that is plainly there.
    for word in context:
        if word in wanted:
            return word
    return None
