# Licensing

Ksav may be distributed later, so every dependency is MIT, BSD, Apache-2.0 or
LGPL. No GPL, no AGPL, and no model weights with a revenue cap.

## What is used

| Component | Licence | Note |
| --- | --- | --- |
| PySide6 (Qt 6) | LGPL-3.0 | Dynamically linked, no fee. **Not PyQt**, which is GPL |
| faster-whisper, CTranslate2 | MIT | |
| PyAV | BSD-3-Clause | Bundles LGPL FFmpeg. Replaces vendoring an ffmpeg binary |
| Whisper model weights | MIT | |
| ivrit.ai Hebrew models | Apache-2.0 | |
| Silero VAD | MIT | |
| sherpa-onnx | Apache-2.0 | Diarization with no account and no gated download |
| Tesseract 5 and tessdata | Apache-2.0 | heb, yid, eng, osd |
| OpenCV | Apache-2.0 | |
| pypdfium2 | BSD-3-Clause, Apache-2.0 | **Not PyMuPDF**, which is AGPL |
| python-docx | MIT | |
| ReportLab | BSD-3-Clause | |
| python-bidi | LGPL-3.0 | Dynamically imported, no derivative work |
| Frank Ruhl Libre | SIL Open Font Licence 1.1 | Embedded in exported PDFs. Licence text ships beside it |
| Tesseract language data | Apache-2.0 | heb, yid, eng and osd, from tessdata_best |
| psutil | BSD-3-Clause | |
| PyInstaller | GPL with a linking exception | Bundling does not affect Ksav's own licence |

## Three traps

### ffmpeg must be the LGPL build

ffmpeg is distributed in LGPL and GPL flavours, and the GPL build is the more
common download. Ksav must bundle the LGPL build, unmodified, with its licence
text. The GPL build would pull the whole application under the GPL. Small detail,
easy to get wrong, expensive to unwind.

### Surya model weights are excluded

Surya's code is Apache-2.0, but its weights carry a modified OpenRAIL-M licence
that is free only for research, personal use and organisations under five million
dollars in revenue and funding. Since Ksav may be distributed, those weights
cannot ship. `dots.ocr` is MIT with no such restriction, which is why it holds the
advanced OCR slot despite wanting 16 GB of VRAM.

### CUDA runtime libraries

NVIDIA's cuBLAS and cuDNN runtime libraries are redistributable under the CUDA
EULA, which is what makes bundling the DLLs legal. This matters in practice:
faster-whisper on Windows is notorious for failing with a missing
`cudnn_ops64_9.dll`, and shipping those DLLs inside the install directory removes
the single most common reason a local Whisper setup fails on Windows. It adds a
few hundred megabytes to the installer and is worth it.

## Not a licence, but worth budgeting for

Without a code signing certificate, Windows SmartScreen warns the first time
anyone runs the installer. That is a certificate purchase, not a code problem.
