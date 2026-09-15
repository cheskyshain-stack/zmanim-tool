"""Live dictation: speech detection, phrasing, the shortcut, and typing out.

The microphone and the Windows parts cannot be exercised on a build machine, so
what is tested here is everything around them: the segmenter that decides when a
phrase ended, the shortcut parser that runs on whatever the user typed, the
spacing between phrases, and the service driven by a synthetic microphone.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest

from app.asr import registry as asr_registry
from app.asr.audio import capture
from app.asr.audio.vad import (
    SAMPLE_RATE,
    EnergyVad,
    Segmenter,
    VadSettings,
    frames_of,
)
from app.asr.demo_engine import register_into
from app.core.settings import Settings
from app.language.lexicon import Lexicon
from app.platform import hotkey, inject
from app.services.dictation import DictationService, State, write_wav
from app.services.transcription import TranscriptionService, TranscriptStore

SEED = "app/language/data/seed_lexicon.jsonl"


def silence(seconds: float, level: float = 0.002, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.normal(0, level, int(SAMPLE_RATE * seconds)).astype(np.float32)


def speech(seconds: float, level: float = 0.09) -> np.ndarray:
    """A rough stand in for a voice: harmonics under a slow envelope."""
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    tone = sum(np.sin(2 * np.pi * f * t) / (i + 1)
               for i, f in enumerate([140, 280, 420, 700]))
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 4 * t)
    return (tone * envelope * level).astype(np.float32)


def segment(stream: np.ndarray, settings: VadSettings | None = None):
    segmenter = Segmenter(EnergyVad(), settings)
    out = []
    for frame in frames_of(stream):
        utterance = segmenter.push(frame)
        if utterance:
            out.append(utterance)
    tail = segmenter.flush()
    if tail:
        out.append(tail)
    return out


# -- speech detection ---------------------------------------------------


def test_silence_produces_no_phrases():
    """Whisper invents text during silence, so silence must never reach it."""
    assert segment(silence(6.0)) == []


def test_two_phrases_separated_by_a_pause_come_out_as_two():
    stream = np.concatenate([
        silence(1.0), speech(1.6), silence(1.2), speech(2.0), silence(1.0),
    ])
    phrases = segment(stream)
    assert len(phrases) == 2
    assert phrases[0].end < phrases[1].start
    assert all(p.reason == "pause" for p in phrases)


def test_a_cough_is_not_a_phrase():
    """The minimum is counted in frames of real speech, not buffer length.

    Measuring the buffer let a 0.1 second cough through as a one second phrase,
    because the buffer carries preroll and hangover padding.
    """
    assert segment(np.concatenate([silence(1.0), speech(0.12), silence(1.5)])) == []


def test_a_door_slamming_is_not_a_phrase():
    loud_and_brief = np.concatenate([silence(1.0), speech(0.04, level=0.4), silence(1.5)])
    assert segment(loud_and_brief) == []


def test_a_short_real_word_is_kept():
    assert len(segment(np.concatenate([silence(1.0), speech(0.4), silence(1.5)]))) == 1


def test_a_long_monologue_is_cut_rather_than_growing_forever():
    phrases = segment(np.concatenate([silence(0.5), speech(10.0)]),
                      VadSettings(max_utterance_seconds=3.0))
    assert len(phrases) >= 2
    assert phrases[0].reason == "length"
    assert all(p.duration <= 3.5 for p in phrases)


def test_the_trailing_pause_is_trimmed():
    """Handing Whisper a long tail of silence invites it to invent words."""
    phrase = segment(np.concatenate([silence(1.0), speech(2.0), silence(2.0)]))[0]
    assert phrase.duration < 3.0, "the whole hangover was kept"
    assert phrase.duration > 1.9, "speech was cut off"


def test_the_start_of_a_phrase_is_not_clipped():
    """Preroll frames exist so the first consonant survives."""
    phrase = segment(np.concatenate([silence(1.0), speech(1.5), silence(1.5)]))[0]
    assert phrase.duration > 1.5


def test_flushing_delivers_a_phrase_still_in_progress():
    segmenter = Segmenter(EnergyVad())
    for frame in frames_of(np.concatenate([silence(0.5), speech(1.5)])):
        segmenter.push(frame)
    assert segmenter.speaking
    tail = segmenter.flush()
    assert tail is not None and tail.reason == "stopped"


def test_the_noise_floor_adapts_to_the_room():
    """A fixed threshold either misses quiet speech or triggers on a fan."""
    noisy_room = np.concatenate([
        silence(2.0, level=0.02), speech(1.5, level=0.12), silence(1.5, level=0.02),
    ])
    assert len(segment(noisy_room)) == 1


# -- capture ------------------------------------------------------------


def test_a_buffer_source_delivers_frames_like_a_microphone():
    audio = np.concatenate([silence(0.5), speech(1.0)])
    source = capture.BufferSource(audio)
    frames = []
    source.start(frames.append)
    source.finished.wait(5)
    source.stop()

    assert len(frames) == len(audio) // 512
    assert all(len(f) == 512 for f in frames)


def test_a_missing_microphone_is_explained_not_hidden():
    usable, reason = capture.available()
    assert reason
    if not usable:
        assert "microphone" in reason.lower() or "audio" in reason.lower()


def test_listing_microphones_never_raises():
    assert isinstance(capture.list_devices(), list)


# -- the shortcut -------------------------------------------------------


@pytest.mark.parametrize("spec,modifiers", [
    ("Ctrl+Alt+D", hotkey.MOD_CONTROL | hotkey.MOD_ALT),
    ("ctrl+alt+d", hotkey.MOD_CONTROL | hotkey.MOD_ALT),
    ("Ctrl-Alt-D", hotkey.MOD_CONTROL | hotkey.MOD_ALT),
    ("Win+Shift+K", hotkey.MOD_WIN | hotkey.MOD_SHIFT),
    ("Ctrl+F9", hotkey.MOD_CONTROL),
])
def test_a_shortcut_parses_to_what_windows_wants(spec, modifiers):
    shortcut = hotkey.parse(spec)
    assert shortcut.modifiers == modifiers
    assert shortcut.key > 0


def test_shortcut_spelling_is_normalised():
    assert hotkey.normalise("ctrl-alt-d") == "Ctrl+Alt+D"
    assert hotkey.normalise("ALT+ctrl+D") == "Ctrl+Alt+D"


@pytest.mark.parametrize("spec,because", [
    ("D", "needs at least one"),
    ("Ctrl+Alt", "only modifier keys"),
    ("Ctrl+Alt+Foo", "does not know the key"),
    ("", "No shortcut"),
    ("Ctrl+A+B", "more than one key"),
])
def test_a_bad_shortcut_is_refused_with_a_reason(spec, because):
    """This runs on whatever the user typed, so the message has to be usable."""
    with pytest.raises(hotkey.HotkeyError) as excinfo:
        hotkey.parse(spec)
    assert because in str(excinfo.value)


def test_a_shortcut_without_a_modifier_is_refused():
    """It would fire every time the user typed that letter anywhere."""
    with pytest.raises(hotkey.HotkeyError):
        hotkey.parse("D")


def test_off_windows_the_manager_says_so_rather_than_pretending():
    manager = hotkey.build()
    usable, reason = manager.available()
    if not usable:
        assert "Windows" in reason
        # It still validates, so the settings box gives feedback either way.
        with pytest.raises(hotkey.HotkeyError):
            manager.register("nonsense", lambda: None)


# -- typing into other programs -----------------------------------------


@pytest.mark.parametrize("previous,text,joiner", [
    ("The Gemara", "asks", " "),
    ("The Gemara ", "asks", ""),
    ("asks", ".", ""),
    ("(", "word", ""),
    ("word", ")", ""),
    ("", "first", ""),
    ("sentence.", "Next", " "),
])
def test_phrases_are_joined_the_way_a_person_would(previous, text, joiner):
    """Running phrases together is the most obvious way for this to look broken."""
    assert inject.spacing_before(previous, text) == joiner


def test_injection_off_windows_fails_clearly_rather_than_silently():
    injector = inject.Injector()
    usable, reason = injector.available()
    if not usable:
        assert "Windows" in reason
        result = injector.send("text")
        assert not result.ok and result.message


# -- the service --------------------------------------------------------


@pytest.fixture
def dictation(tmp_path):
    asr_registry.reset()
    register_into(asr_registry)

    settings = Settings()
    settings.transcription.engine_id = "demo"
    settings.dictation.model_id = "demo"
    settings.dictation.inject_into_focused_app = False

    lexicon = Lexicon(tmp_path / "lex.sqlite")
    lexicon.seed_from(SEED)
    transcription = TranscriptionService(settings, lexicon, TranscriptStore(tmp_path / "t"))

    def build(audio, realtime=False):
        source = capture.BufferSource(audio, realtime=realtime)
        service = DictationService(settings, transcription, source=source,
                                   vad=EnergyVad())
        return service, source

    yield build, settings
    lexicon.close()
    asr_registry.reset()


def drain(service, source, timeout=6.0):
    phrases = []
    service.on_phrase = phrases.append
    ok, message = service.start()
    assert ok, message
    source.finished.wait(timeout)
    time.sleep(0.8)
    service.stop()
    return phrases


def test_speaking_produces_corrected_text(dictation):
    build, _settings = dictation
    service, source = build(np.concatenate([
        silence(0.5), speech(1.5), silence(1.2), speech(1.5), silence(0.8),
    ]))
    phrases = drain(service, source)

    assert len(phrases) == 2
    assert all(p.text.strip() for p in phrases)
    assert any("Gemara" in p.text for p in phrases), "the dictionary did not run"
    assert any("camera" in p.raw for p in phrases), "the raw text was not kept"


def test_corrections_can_be_switched_off(dictation):
    build, settings = dictation
    settings.dictation.apply_corrections = False
    service, source = build(np.concatenate([silence(0.5), speech(1.5), silence(0.8)]))
    phrases = drain(service, source)

    assert phrases
    assert phrases[0].text == phrases[0].raw


def test_no_frame_is_lost_to_the_startup_race(dictation):
    """The state has to be listening before the first frame arrives.

    A real microphone takes a few milliseconds to deliver anything, which hid
    this. A buffered source loses every frame to it, and so would a fast machine.
    """
    build, _settings = dictation
    service, source = build(np.concatenate([silence(0.4), speech(1.5), silence(0.8)]))
    assert drain(service, source), "every frame was dropped before listening began"


def test_stopping_still_delivers_the_phrase_in_progress(dictation):
    build, _settings = dictation
    service, source = build(np.concatenate([silence(0.4), speech(3.0)]), realtime=True)
    phrases = []
    service.on_phrase = phrases.append
    service.start()
    time.sleep(1.5)
    service.stop()
    assert len(phrases) == 1, "stopping threw away what had been said"


def test_the_states_a_user_sees_are_reported(dictation):
    build, _settings = dictation
    service, source = build(np.concatenate([silence(0.4), speech(1.5), silence(0.8)]))
    states = []
    service.on_state = states.append
    service.on_phrase = lambda _p: None
    service.start()
    source.finished.wait(5)
    time.sleep(0.6)
    service.stop()

    assert State.LISTENING in states
    assert State.THINKING in states, "the user is never told it is working"
    assert states[-1] == State.IDLE
    assert service.state == State.IDLE


def test_silence_alone_produces_nothing(dictation):
    build, _settings = dictation
    service, source = build(silence(4.0))
    assert drain(service, source) == []


def test_a_missing_model_is_reported_before_listening(dictation, monkeypatch):
    build, settings = dictation
    settings.dictation.model_id = "whisper-large-v3"
    service, _source = build(silence(1.0))

    usable, reason = service.available()
    assert not usable
    assert "Model Vault" in reason


def test_the_written_phrase_is_what_an_engine_expects(tmp_path):
    path = write_wav(tmp_path / "p.wav", speech(1.0))
    import wave

    with wave.open(str(path)) as handle:
        assert handle.getnchannels() == 1
        assert handle.getframerate() == SAMPLE_RATE
        assert handle.getsampwidth() == 2
        assert handle.getnframes() == SAMPLE_RATE
