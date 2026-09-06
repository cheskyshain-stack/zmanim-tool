# Architecture

Six layers. Everything below the interface is importable and testable without
Qt, which is why the correction engine, the dictionary and the exporters get
real unit tests rather than click testing.

```
UI (Qt)          home, transcribe, dictation, ocr review, dictionary,
                 settings, model vault, privacy pill
    |            calls only through the service layer, never a model directly
Services         JobQueue, TranscriptionService, DictationService,
                 OcrService, ExportService
    |            every engine is an interface with a registry behind it
Engines          AsrEngine, VadEngine, DiarizationEngine, OcrEngine, LayoutEngine
Language         Lexicon, CorrectionEngine, Renderer (modes A to D), phonetics
Platform         hardware probe, ModelManager, net (the only socket),
                 hotkeys, text injection, ffmpeg
Storage          settings.json, lexicon.sqlite, jobs journal, model cache
```

## Three decisions that shape everything else

### One annotated transcript, four renderings

The output modes are not four transcription runs and not four saved documents.
The engine result is stored once, raw, and every Yeshivish correction is
recorded separately as a `Correction` pointing at a character span in a segment.
Modes A, B, C and D are four render passes over that same pair.

This buys three things:

* Switching modes is instant and lossless.
* Mode D genuinely is the untouched engine output, not an attempt to reverse the
  corrections.
* A corrections panel can list every change with its reason and a per item undo,
  and fixing a dictionary entry re-renders old transcripts correctly instead of
  leaving them wrong forever.

See `app/core/models.py`.

### The dictionary feeds the decoder, it does not only clean up after it

A find and replace pass over Whisper output is the weak version of this.
`TranscribeOptions.hotwords` and `initial_prompt` carry terms into the decoder so
recognition is biased toward Torah vocabulary before the model commits to a
word. The same lexicon is then used again for correction afterwards.

Whisper's prompt is capped at roughly 224 tokens, so the terms sent to the
decoder are a ranked selection by category, recent use and what has already
appeared earlier in the recording. Not the whole vocabulary. That cap is real
and stating it is better than implying the entire dictionary reaches the model.

### Corrections are gated, never global

Mapping "camera" to Gemara is right in a shiur and wrong in a sentence about a
photograph. The lexicon entry format handles that directly:

* **Boundary aware matching.** Tokenised, so "camera" never fires inside
  "cameras" unless the entry says it should.
* **Risk tiers.** A variant that is also an ordinary English word is marked risky
  and needs context before it fires.
* **Context and anti-context.** An entry can require nearby words, and can be
  blocked by others.
* **Suggest rather than apply.** Anything below the confidence threshold appears
  in the review panel instead of being written into the text.
* **Provenance on every change,** so nothing happens that cannot be seen and
  reversed.

Matching uses an Aho-Corasick automaton over token n-grams, which finds every one
of a hundred thousand terms in a single linear pass rather than running a hundred
thousand regexes. A Yeshivish tuned phonetic key sits on top of that to catch
misrecognitions nobody has entered yet, always as a suggestion.

## Swapping an engine

Each engine is an abstract base class with a registry:

```python
AsrEngine.transcribe(audio_path, options) -> Transcript
OcrEngine.recognize(image_path, options)  -> PageText
```

Adding an engine is a new file, one registry line, and a catalogue entry in
`app/platform/models.py`. No service or interface code changes. That is the
concrete meaning of replacing the transcription or OCR model later without
rewriting the program.

## Offline enforcement

`app/platform/net.py` is the only module permitted to open a socket, and its
gate is a context manager so it cannot be left open by an early return or an
exception. `tests/test_no_network.py` enforces both halves: a static scan of
every source file, and a runtime pass with sockets replaced by something that
raises.

Adding a feature that needs the network means routing it through that module and
putting it behind the gate, with the interface saying so. It does not mean
relaxing the test.

## What is honestly hard

Recorded here so it is not rediscovered later.

* **Yeshivish code switching.** No model is trained on it. Whisper handles the
  English carrier well and mangles the Torah terms. The dictionary carries the
  load. The real fix is a fine tune, which is why corrected transcripts are
  exportable as training data in Phase 4.
* **Live dictation latency.** Text appears when the speaker pauses, roughly half
  a second to a second and a half per phrase, not word by word. True streaming
  models exist and none of them know Hebrew.
* **Rashi script.** There is no good off the shelf offline model. The engine slot
  exists and is empty. Tesseract on Rashi produces garbage.
* **Gemara page layout.** The tzuras hadaf with commentaries wrapping the text is
  one of the hardest layouts in print. Expect useful main text and poor handling
  of the wrapped commentaries.
* **Old printed seforim.** Roughly 60 to 80 percent on nineteenth century
  rabbinic print, meaning heavy correction. Preprocessing helps and does not
  solve it.
* **Nekudos.** Usually dropped or garbled. Plan for stripping them cleanly rather
  than reading them until a nekudos capable model is in the slot.
* **Typing into elevated applications.** Windows blocks synthetic input from a
  normal application into one running as administrator. Running Ksav elevated
  should be an opt in, not a default.
