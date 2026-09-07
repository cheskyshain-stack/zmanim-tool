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

Matching uses a token n-gram index. The original design note said Aho-Corasick,
and that was changed during Phase 1 for a reason worth recording rather than
quietly substituting.

Aho-Corasick earns its complexity when patterns are character sequences of
unbounded length. Here the patterns are runs of whole words and no Torah term is
longer than a handful of them, so indexing each term by its normalised token run
and looking up at most six slices per position gives the same linear cost in the
length of the transcript, builds in a fraction of the time, uses less memory,
needs no compiled dependency, and can be read by anyone. Matching is on tokens
throughout, so word boundaries are structural rather than a regex that has to be
got right. Measured: a 3,000 term dictionary indexes in well under a second and
matches a long transcript in single digit milliseconds.

A Yeshivish tuned phonetic key sits on top to catch spelling variants nobody has
entered yet, always as a suggestion. It covers the axes that actually vary in
transliteration: ch and kh, tz and ts, the sav against the tav, and vowels. It is
deliberately not for acoustic confusions like the model writing "camera" for
Gemara, because nothing phonetic connects a gimel to a kof; those belong in the
dictionary as explicit heard as variants.

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

## Reading pages

Recognition and layout are separate on purpose. A page can be laid out well and
read badly, or the reverse, and keeping them apart means the Rashi problem can be
attacked by swapping the recogniser without touching column detection.

Three things in the OCR path are worth knowing.

**Skew is measured by projection profile, not by minAreaRect on the ink.**
minAreaRect was tried first: its angle convention differs between OpenCV versions
(5.0 returns (-90, 0] and swaps the rectangle's sides depending on orientation)
and the dilation needed to join letters into lines smears the measurement by
close to a degree. Rotating the page through candidate angles and maximising the
variance of the row totals lands within 0.1 degrees, in about 20 milliseconds on
a downscaled copy, and does not care which OpenCV is installed.

**Columns are read as separate images.** Handed a two column page whole,
Tesseract merges the columns and reads straight across them: every word is
correct and every sentence is nonsense. Gutters are found first, by vertical
projection, and each column is recognised on its own with its boxes offset back
into page coordinates. Reading order then follows the page direction, so a
Hebrew page reads its right column first and an English one its left.

**Direction is decided per block by the first strong character**, which is what
the Unicode bidi algorithm does and therefore what Word, a browser and Ksav's own
PDF export will all do with the same text. Counting Hebrew against Latin
characters was tried and got the common case wrong: "The Gemara asks a kashya"
with the Torah terms in Hebrew has as many Hebrew letters as Latin ones, and is
plainly an English sentence.

Sauvola thresholding is implemented rather than imported because the OpenCV
wheel does not carry the contrib module that has it, and on an old sefer with
yellowed paper and bleed through from the reverse, one global threshold either
loses the faint letters or fills the page with the ghost of the other side.

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
