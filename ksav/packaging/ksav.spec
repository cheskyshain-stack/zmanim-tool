# PyInstaller spec for Ksav.
#
# Proved on a clean Windows machine in Phase 0 rather than discovered in Phase 4.
# A Python application a nontechnical person cannot install is the failure this
# project is most likely to die of, so the installer is a gate on every phase,
# not a task at the end.
#
# Build:  pyinstaller packaging/ksav.spec --noconfirm
#
# Models are NOT bundled. They are downloaded once from the Model Vault, or
# imported from a folder on a machine that has never been online. That keeps the
# installer at a few hundred megabytes instead of several gigabytes.

import sys
from pathlib import Path

ROOT = Path(SPECPATH).parent
VENDOR = ROOT / "packaging" / "vendor"

# Vendored binaries, copied in by packaging/fetch-vendor.py.
#   ffmpeg      LGPL build only. The GPL build would pull Ksav under the GPL.
#   tesseract   Apache-2.0, with heb, yid, eng and osd traineddata.
#   cuda        cuBLAS and cuDNN runtime DLLs, redistributable under the CUDA EULA.
#               These are what stop the "cudnn_ops64_9.dll not found" failure that
#               makes local Whisper give up on so many Windows machines.
binaries = []
datas = []

for name in ("ffmpeg", "tesseract", "cuda"):
    folder = VENDOR / name
    if folder.is_dir():
        datas.append((str(folder), f"vendor/{name}"))

# The seed Yeshivish vocabulary ships with the application.
seed = ROOT / "app" / "language" / "data"
if seed.is_dir():
    datas.append((str(seed), "app/language/data"))

a = Analysis(
    [str(ROOT / "app" / "main.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=[],
    # Nothing that could reach the network gets pulled in by accident.
    excludes=["tkinter", "matplotlib", "pytest", "requests", "httpx"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Ksav",
    console=False,          # a desktop app, not a terminal
    icon=str(ROOT / "packaging" / "ksav.ico") if (ROOT / "packaging" / "ksav.ico").is_file() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name="Ksav",
)
