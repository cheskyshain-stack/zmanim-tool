# Ksav

Offline transcription, dictation and OCR for Windows, built for Yeshivish and
Torah speech and print.

After installation and a one time model download, everything runs on your own
computer. Recordings, images, documents and text never leave it. You can
disconnect the network completely and keep working.

## Where the project is

Phases 0, 1 and 2 of four are complete. Ksav transcribes recordings offline,
corrects Yeshivish and Torah terminology against a dictionary that also primes
the recogniser, reads text from photos, scans and PDFs in Hebrew and English,
and exports to TXT, DOCX, PDF, SRT and VTT.

| Phase | What it brings | State |
| --- | --- | --- |
| 0 | Shell, settings, hardware probe, Model Vault, engine interfaces, installer, USB bundle and portable mode | Done |
| 1 | Offline transcription, transcript editor, dictionary, corrections, exports | Done |
| 2 | OCR for images and PDFs, side by side review | Done |
| 3 | Live dictation and the global Windows shortcut | Next |
| 4 | Diarization, advanced OCR, large Torah vocabulary, auto model selection | Planned |

### What works now

Drop in an MP3, WAV, M4A, MP4, AAC or FLAC and Ksav transcribes it on this
computer. The queue shows real progress and a finish time, survives being
closed, and resumes an interrupted job. The transcript opens in an editor where
clicking a paragraph jumps the recording to it.

The dictionary does two jobs. Before the model decides on a word, a ranked
selection of Torah terms goes into its hotwords and prompt. Afterwards, the full
vocabulary corrects the result, with word boundaries and context respected:

```
"The camera asks a kashya"          ->  camera becomes Gemara
"I took a photo with the camera"    ->  left alone
"He picked up the camera and left"  ->  offered as a suggestion, not applied
```

Four output modes render from one stored transcript, so switching is instant and
the original is never lost:

```
Yeshivish English   The Gemara asks a kashya on Rav Huna.
Hebrew script       The גמרא asks a קשיא on רב הונא.
Automatic mixed     decided per term, masechtos in Hebrew by default
Original            The camera asks a kasha on Rav Huna.
```

Every correction is listed with the reason it fired and can be reversed one at a
time. Export goes to TXT, DOCX, SRT and VTT, with Hebrew marked as complex
script so Word renders it in the right font.

### Reading pages

Drop in a photo, a scan, a PDF or a folder of scans. Before anything is read the
page is straightened, de-speckled, contrast lifted and thresholded, and the
review screen says what it did. A PDF that already carries its own text is read
directly rather than photographed and OCR'd, which is instant and perfectly
accurate.

Two column pages are read a column at a time, so a Hebrew sefer reads its right
column first instead of straight across both. The review screen puts the
original page on the left and editable text on the right, and clicking a
paragraph draws a box around the part of the page it came from.

Rashi script, old rabbinic print and nekudos are honestly hard, and Ksav says so
on screen before the work starts rather than after an hour of correcting.

`docs/architecture.md` explains the design. `docs/licensing.md` covers the
dependency obligations, including two that are easy to get wrong.

## Running it during development

```
pip install -r requirements-dev.txt
python -m app.main
```

Tests, including the headless interface tests, run with no display attached:

```
QT_QPA_PLATFORM=offscreen python -m pytest tests -q
```

## Putting it on a USB stick

The computer you use Ksav on never needs an internet connection. On a computer
that does have one:

```
pyinstaller packaging/ksav.spec --noconfirm
python packaging\make-usb-bundle.py --models whisper-medium --out D:\
```

That writes a `KsavUSB` folder holding the program, the installer and the models.
Copy it to a stick. On the offline computer, either open `KsavUSB\Ksav` and
double click `Ksav` to run it straight off the stick, or run the installer and
let Ksav find the models on the stick by itself.

Ksav is a normal Windows program, not a web page. No browser is involved at any
point, online or offline. `docs/usb.md` has the detail.

## Building the Windows installer

```
pyinstaller packaging/ksav.spec --noconfirm
iscc packaging\installer.iss
```

The result is a per user installer that needs no administrator rights. Models
are not bundled: they are downloaded once from the Model Vault, or imported from
a folder for a machine that has never been online.

## Privacy

This is the point of the project, so it is enforced rather than promised.

* `app/platform/net.py` is the only module in Ksav that may open a socket, and
  it refuses to transfer anything unless a caller has explicitly opened the gate.
  The Model Vault is the only caller.
* `tests/test_no_network.py` scans every source file and fails the build if
  anything else imports a networking library, then runs a full transcription
  with sockets replaced by something that raises.
* Inference libraries are pinned offline at process start, so none of them can
  quietly fetch a missing file.
* No account, no licence check, no telemetry, no update ping.

## Where your files live

Everything Ksav writes is under one folder, so it can be backed up, moved or
deleted in one go:

When Ksav is installed normally:

```
%LOCALAPPDATA%\Ksav\
    settings.json      your settings
    lexicon.sqlite     the Yeshivish dictionary
    models\            downloaded speech and OCR models
    jobs\              in progress transcription jobs, so a crash resumes
    logs\              local only, never transmitted
```

When it is running portable from a USB stick, the same folders sit in `KsavData`
beside the program instead, and nothing is written to the host computer.
