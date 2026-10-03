# PyInstaller spec for Ksav.
#
# Build:  pyinstaller packaging/ksav.spec --noconfirm
#
# Models are NOT bundled. They install once from the Model Vault, or from a USB
# stick, which keeps the installer at a few hundred megabytes instead of several
# gigabytes and lets one download serve several machines.
#
# What IS bundled: the seed dictionary, the Hebrew font the PDF exporter embeds,
# and Tesseract with its language data when packaging/fetch-vendor.py has put it
# in place. There is deliberately no ffmpeg: PyAV carries FFmpeg's libraries
# already, built under the LGPL, which removes both the extra binary and the
# risk of shipping a GPL build by mistake.

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

ROOT = Path(SPECPATH).parent
VENDOR = ROOT / "packaging" / "vendor"

datas = []
binaries = []
hiddenimports = []

# --- packages that need collecting by hand --------------------------------
#
# Only the ones PyInstaller does not already have a hook for. Collecting a
# package that IS hooked gathers everything twice: the first build shipped cv2
# and ctranslate2 and av in duplicate and came to 747 MB. Measure before adding
# anything back here.
for package in ("faster_whisper",):     # its bundled VAD and tokenizer assets
    try:
        datas += collect_data_files(package)
    except Exception as exc:            # not installed is not fatal at build time
        print(f"[ksav.spec] skipping {package}: {exc}")

hiddenimports += [
    "faster_whisper",
    "ctranslate2",
    "av",
    "sounddevice",
    "onnxruntime",
    "pytesseract",
    "pypdfium2",
    "bidi",
    "bidi.algorithm",
    "docx",
    "reportlab",
    "psutil",
    "sqlite3",
]

# --- what ships with the application --------------------------------------

seed = ROOT / "app" / "language" / "data"
if seed.is_dir():
    datas.append((str(seed), "app/language/data"))

fonts = ROOT / "app" / "export" / "fonts"
if fonts.is_dir():
    datas.append((str(fonts), "app/export/fonts"))

# Tesseract and its language data, put here by packaging/fetch-vendor.py. The
# build works without it and the application then falls back to a Tesseract on
# the PATH, saying so plainly when there is none.
tesseract = VENDOR / "tesseract"
if tesseract.is_dir():
    datas.append((str(tesseract), "packaging/vendor/tesseract"))
    print(f"[ksav.spec] bundling Tesseract from {tesseract}")
else:
    print("[ksav.spec] no vendored Tesseract; run packaging/fetch-vendor.py first")

# --- what is deliberately left out ----------------------------------------
#
# Qt ships a great deal Ksav does not use, and every megabyte is a megabyte the
# user downloads. Nothing network capable is pulled in by accident either.
excludes = [
    "tkinter", "matplotlib", "pytest", "requests", "httpx", "IPython",
    "notebook", "torch", "transformers", "scipy", "pandas",
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtWebEngineQuick",
    "PySide6.Qt3DCore", "PySide6.Qt3DRender", "PySide6.QtCharts",
    "PySide6.QtDataVisualization", "PySide6.QtQuick3D", "PySide6.QtBluetooth",
    "PySide6.QtNfc", "PySide6.QtPositioning", "PySide6.QtSerialPort",
    "PySide6.QtWebSockets", "PySide6.QtWebChannel", "PySide6.QtSql",
    "PySide6.QtTest", "PySide6.QtDesigner", "PySide6.QtHelp",
]

icon = ROOT / "packaging" / "ksav.ico"

a = Analysis(
    [str(ROOT / "app" / "main.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Ksav",
    debug=False,
    strip=False,
    upx=False,               # UPX trips virus scanners for no real size win
    console=False,           # a desktop application, not a terminal
    icon=str(icon) if icon.is_file() else None,
    version=str(ROOT / "packaging" / "version_info.txt")
    if (ROOT / "packaging" / "version_info.txt").is_file() and sys.platform == "win32"
    else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Ksav",
)
