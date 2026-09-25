"""The correction engine: the part that must never be a global find and replace."""

from __future__ import annotations

import pytest

from app.core.models import CorrectedTranscript, OutputMode, Segment, Transcript
from app.language import corrector, matcher, phonetics, render
from app.language.lexicon import Entry, Lexicon, Variant
from app.language.normalize import normalize, tokenize

SEED = "app/language/data/seed_lexicon.jsonl"


@pytest.fixture
def lexicon(tmp_path):
    lex = Lexicon(tmp_path / "lex.sqlite")
    lex.seed_from(SEED)
    yield lex
    lex.close()


@pytest.fixture
def index(lexicon):
    return matcher.build(lexicon)


@pytest.fixture
def categories(lexicon):
    return {e.id: e.category for e in lexicon.all()}


def changes(text, index, policy=None):
    result = corrector.correct_segment(Segment(0, 0, 1, text), index, policy)
    return {c.raw: c.canonical for c in result
            if c.applied and c.raw.casefold() != c.canonical.casefold()}


def suggestions(text, index, policy=None):
    result = corrector.correct_segment(Segment(0, 0, 1, text), index, policy)
    return {c.raw: c.canonical for c in result if not c.applied}


# -- tokenising ---------------------------------------------------------


def test_tokens_keep_their_place_in_the_string():
    text = "The camera asks a kashya, and v'tarya follows."
    for token in tokenize(text):
        assert text[token.start:token.end] == token.text


def test_apostrophes_and_hyphens_fold_to_one_key():
    assert normalize("v'tarya") == normalize("vtarya") == normalize("v-tarya")


def test_hebrew_is_left_alone_by_normalisation():
    assert normalize("גמרא") == "גמרא"


# -- phonetics ----------------------------------------------------------


@pytest.mark.parametrize("canonical,variant", [
    ("Gemara", "gemorah"), ("Gemara", "gmara"),
    ("Tosafos", "Tosafot"), ("Tosafos", "Toisfos"),
    ("Shabbos", "Shabbat"), ("machlokes", "machloket"),
    ("chazakah", "khazoko"), ("svara", "sevoro"),
])
def test_spelling_variants_share_a_phonetic_key(canonical, variant):
    assert phonetics.keys(canonical) & phonetics.keys(variant)


def test_the_sav_and_tav_split_is_bridged():
    """Shabbos against Shabbat is the axis this key exists for."""
    assert phonetics.keys("Tosafot") & phonetics.keys("Tosafos")


def test_similarity_separates_words_the_coarse_key_pairs():
    """shver and svara both reduce to SVR, which is why similarity is checked."""
    assert phonetics.keys("shver") & phonetics.keys("svara")
    assert phonetics.similarity("shver", "svara") < 0.6


# -- matching -----------------------------------------------------------


def test_the_longest_phrase_wins(index):
    matched = [m.raw for m in index.find("He learned Bava Metzia today")]
    assert "Bava Metzia" in matched
    assert "Bava" not in matched


def test_matches_never_overlap(index):
    found = index.find("The camera asks a kasha on Rav Huna and Tosfos answers")
    for earlier, later in zip(found, found[1:]):
        assert earlier.end <= later.start


def test_a_term_inside_a_longer_word_does_not_fire(index):
    """Boundary awareness is structural here, not a regex that has to be right."""
    assert changes("He bought cameras for the shiur", index) == {}


# -- the gating rules ---------------------------------------------------


def test_a_risky_word_corrects_when_the_context_supports_it(index):
    assert changes("The camera asks a kashya", index) == {"camera": "Gemara"}


def test_a_risky_word_is_left_alone_without_context(index):
    """The whole point. A photograph must not become a Gemara."""
    assert changes("He picked up the camera and left", index) == {}


def test_a_blocked_word_is_not_even_suggested(index):
    """A wrong suggestion is worse than silence."""
    text = "I took a photo with the camera on my phone"
    assert changes(text, index) == {}
    assert suggestions(text, index) == {}


def test_a_risky_word_without_context_is_offered_for_review(index):
    assert suggestions("He picked up the camera and left", index) == {"camera": "Gemara"}


def test_turning_the_context_rule_off_makes_corrections_aggressive(index):
    loose = corrector.Policy(require_context_for_risky=False)
    assert changes("He picked up the camera and left", index, loose) == {"camera": "Gemara"}


def test_an_ordinary_spelling_variant_needs_no_context(index):
    assert changes("The gemorah brings a proof", index) == {"gemorah": "Gemara"}


def test_a_transliteration_is_not_treated_as_an_english_collision(lexicon):
    """brocha and torah were both wrongly listed as English lookalikes once.

    The symptom was Ksav refusing to correct a word that was never ambiguous.
    This checks the whole shipped dictionary rather than those two cases.
    """
    wrong = [
        (v.text, e.canonical)
        for e in lexicon.all() for v in e.variants
        if v.risk == "risky" and not v.requires_context
    ]
    assert not wrong, (
        "These spellings were auto-marked risky but have no context rules, so "
        f"they will never be corrected: {wrong}"
    )


def test_context_reaches_into_the_neighbouring_segment(index):
    """A shiur does not respect segment boundaries."""
    transcript = Transcript(segments=[
        Segment(0, 0, 2, "The camera"),
        Segment(1, 2, 4, "asks a kashya on Rav Huna."),
    ])
    corrections = corrector.correct(transcript, index)
    applied = {c.raw: c.canonical for c in corrections if c.applied}
    assert applied.get("camera") == "Gemara"


def test_every_correction_carries_its_reason_and_place(index):
    transcript = Transcript(segments=[
        Segment(0, 0, 2, "The camera asks a kasha."),
        Segment(1, 2, 4, "Tosfos answers."),
    ])
    for correction in corrector.correct(transcript, index):
        assert correction.reason
        assert correction.segment_index >= 0
        assert 0 <= correction.start < correction.end


def test_phonetic_hits_are_suggestions_and_never_applied(index):
    found = corrector.correct_segment(Segment(0, 0, 1, "The gemoiro says so"), index)
    phonetic = [c for c in found if c.kind.value == "phonetic"]
    assert all(not c.applied for c in phonetic)


# -- the four modes -----------------------------------------------------


@pytest.fixture
def corrected(index):
    transcript = Transcript(segments=[
        Segment(0, 0, 4, "The camera asks a kasha on Rav Huna,"),
        Segment(1, 4, 8, "and Tosfos says this svara is not shver."),
        Segment(2, 8, 12, "The Rambam in hilchos shabbos holds differently.",
                paragraph_break=True),
    ])
    return CorrectedTranscript(transcript, corrector.correct(transcript, index))


def test_mode_a_is_the_brief_s_example(corrected, categories):
    text = render.render(corrected, OutputMode.YESHIVISH_ENGLISH, categories=categories)
    assert "The Gemara asks a kashya on Rav Huna" in text


def test_mode_b_puts_torah_terms_into_hebrew(corrected, categories):
    text = render.render(corrected, OutputMode.HEBREW_SCRIPT, categories=categories)
    assert "The גמרא asks a קשיא on רב הונא" in text


def test_mode_c_decides_per_term(corrected, categories):
    text = render.render(corrected, OutputMode.AUTO_MIXED, categories=categories)
    assert "שבת" in text, "a masechta should be in Hebrew by default"
    assert "Gemara" in text, "and the rest should stay in English"


def test_mode_d_is_untouched_engine_output(corrected):
    text = render.render(corrected, OutputMode.RAW)
    assert "camera" in text and "kasha" in text and "Tosfos" in text
    assert "Gemara" not in text


def test_switching_mode_never_changes_the_stored_transcript(corrected, categories):
    before = corrected.transcript.text()
    for mode in OutputMode:
        render.render(corrected, mode, categories=categories)
    assert corrected.transcript.text() == before


def test_undoing_a_correction_brings_the_raw_word_back(corrected, categories):
    camera = next(c for c in corrected.corrections if c.raw == "camera")
    assert "Gemara" in render.render(corrected, OutputMode.YESHIVISH_ENGLISH,
                                     categories=categories)
    camera.applied = False
    text = render.render(corrected, OutputMode.YESHIVISH_ENGLISH, categories=categories)
    assert "camera" in text and "Gemara" not in text


def test_capitalisation_follows_the_word_being_replaced(index):
    assert changes("Camera asks a kashya", index) == {"Camera": "Gemara"}
    result = corrector.correct_segment(Segment(0, 0, 1, "Camera asks a kashya"), index)
    camera = next(c for c in result if c.raw == "Camera")
    assert render.replacement_for(camera, OutputMode.YESHIVISH_ENGLISH,
                                 render.RenderPolicy()) == "Gemara"


def test_paragraphs_follow_the_pauses(corrected, categories):
    paragraphs = render.render_paragraphs(corrected, OutputMode.YESHIVISH_ENGLISH,
                                          categories=categories)
    assert len(paragraphs) == 2
    assert paragraphs[0][0] == 0 and paragraphs[1][0] == 8


# -- the dictionary itself ----------------------------------------------


def test_search_finds_a_term_by_any_of_its_forms(lexicon):
    for query in ("gemara", "camera", "גמרא", "gemorah"):
        assert any(e.canonical == "Gemara" for e in lexicon.search(query)), query


def test_importing_the_same_list_twice_merges_rather_than_duplicates(lexicon):
    before = lexicon.count()
    added, merged = lexicon.import_file(SEED)
    assert added == 0 and merged == before
    assert lexicon.count() == before


def test_export_and_reimport_keeps_the_spellings(lexicon, tmp_path):
    for suffix in (".jsonl", ".csv"):
        path = tmp_path / f"out{suffix}"
        lexicon.export_file(path)
        fresh = Lexicon(tmp_path / f"fresh{suffix}.sqlite")
        fresh.import_file(path)
        assert fresh.count() == lexicon.count()
        assert len(fresh.search("Gemara")[0].variants) >= 5
        fresh.close()


def test_a_deleted_seeded_term_stays_deleted(lexicon):
    entry = lexicon.search("Gemara")[0]
    lexicon.delete(entry.id)
    assert lexicon.seed_from(SEED) == 0
    assert not lexicon.search("Gemara")


def test_priming_puts_the_terms_that_matter_first(lexicon):
    """Ranking by length once buried Gemara under three letter masechtos."""
    terms = lexicon.priming_terms(20)
    assert "kashya" in terms and "sugya" in terms
    assert len(terms) == 20


def test_a_new_term_is_matched_immediately(lexicon):
    lexicon.add(Entry(
        canonical="Ohr Somayach", hebrew="אור שמח", category="sefer",
        variants=[Variant("or sameach"), Variant("ohr sameach")],
    ))
    index = matcher.build(lexicon)
    assert changes("The or sameach argues", index) == {"or sameach": "Ohr Somayach"}


def test_a_large_dictionary_stays_fast(lexicon):
    """The vocabulary is meant to reach thousands of terms and keep working."""
    import time

    for i in range(3000):
        lexicon.add(Entry(canonical=f"term{i}", variants=[Variant(f"trm{i}")]))
    start = time.time()
    index = matcher.build(lexicon)
    build_seconds = time.time() - start

    text = "The camera asks a kasha on Rav Huna and Tosfos answers. " * 40
    start = time.time()
    index.find(text)
    find_seconds = time.time() - start

    assert build_seconds < 5.0, f"index build took {build_seconds:.1f}s"
    assert find_seconds < 0.5, f"matching took {find_seconds:.2f}s"
