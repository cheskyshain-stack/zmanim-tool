"""What is this computer, and which model should it run.

Every probe here is local. Nothing is looked up, reported, or sent anywhere.
Each one degrades quietly: a machine with no NVIDIA driver, no PowerShell, or a
locked down registry still produces a usable answer rather than an exception,
because the recommendation must never be the reason the app fails to start.
"""

from __future__ import annotations

import json
import platform as _platform
import re
import subprocess
import sys
from dataclasses import dataclass, field

from ..core.logging import get

log = get(__name__)

_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


@dataclass
class Gpu:
    name: str
    vendor: str                 # nvidia | amd | intel | apple | unknown
    vram_mb: int | None = None
    driver: str | None = None

    @property
    def vram_gb(self) -> float | None:
        return round(self.vram_mb / 1024, 1) if self.vram_mb else None


@dataclass
class Hardware:
    cpu_name: str = "Unknown CPU"
    physical_cores: int = 1
    logical_cores: int = 1
    ram_gb: float = 0.0
    gpus: list[Gpu] = field(default_factory=list)
    cuda_available: bool = False
    cuda_version: str | None = None
    os_name: str = ""

    @property
    def nvidia(self) -> Gpu | None:
        for gpu in self.gpus:
            if gpu.vendor == "nvidia":
                return gpu
        return None

    @property
    def best_vram_gb(self) -> float:
        values = [g.vram_gb for g in self.gpus if g.vram_gb]
        return max(values) if values else 0.0

    def summary(self) -> str:
        parts = [self.cpu_name, f"{self.physical_cores} cores", f"{self.ram_gb:.0f} GB RAM"]
        if self.gpus:
            gpu = self.nvidia or self.gpus[0]
            vram = f" {gpu.vram_gb:g} GB" if gpu.vram_gb else ""
            parts.append(f"{gpu.name}{vram}")
        else:
            parts.append("no dedicated GPU")
        return ", ".join(parts)


def _run(args: list[str], timeout: float = 6.0) -> str:
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=_NO_WINDOW,
        )
        return result.stdout if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _cpu_name() -> str:
    if sys.platform == "win32":
        try:
            import winreg

            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            )
            with key:
                value, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                return str(value).strip()
        except OSError:
            pass
        return _platform.processor() or "Unknown CPU"

    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.lower().startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return _platform.processor() or _platform.machine() or "Unknown CPU"


def _nvidia_gpus() -> tuple[list[Gpu], str | None]:
    """Ask the NVIDIA driver directly. Absent driver means no NVIDIA GPU in use."""
    out = _run([
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ])
    gpus: list[Gpu] = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            continue
        try:
            vram = int(float(parts[1]))
        except ValueError:
            vram = None
        gpus.append(Gpu(parts[0], "nvidia", vram, parts[2] if len(parts) > 2 else None))

    cuda_version = None
    header = _run(["nvidia-smi"])
    match = re.search(r"CUDA Version:\s*([\d.]+)", header)
    if match:
        cuda_version = match.group(1)
    return gpus, cuda_version


def _vendor_of(name: str) -> str:
    low = name.lower()
    if "nvidia" in low or "geforce" in low or "quadro" in low or "rtx" in low:
        return "nvidia"
    if "amd" in low or "radeon" in low:
        return "amd"
    if "intel" in low or "arc" in low:
        return "intel"
    if "apple" in low:
        return "apple"
    return "unknown"


def _windows_gpus() -> list[Gpu]:
    """List display adapters through CIM.

    AdapterRAM is a 32 bit field and misreports anything above 4 GB, so it is
    used only as a rough hint and never for an NVIDIA card, where nvidia-smi has
    already given a real figure.
    """
    out = _run([
        "powershell", "-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_VideoController | "
        "Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress",
    ], timeout=12.0)
    if not out.strip():
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return []
    if isinstance(data, dict):
        data = [data]

    gpus: list[Gpu] = []
    for item in data:
        name = (item.get("Name") or "").strip()
        if not name:
            continue
        vendor = _vendor_of(name)
        vram = item.get("AdapterRAM")
        vram_mb = None
        if isinstance(vram, (int, float)) and vram > 0:
            vram_mb = int(vram / (1024 * 1024))
            if vram_mb >= 4000:
                vram_mb = None      # the 32 bit wrap, not a real figure
        gpus.append(Gpu(name, vendor, vram_mb, item.get("DriverVersion")))
    return gpus


def detect() -> Hardware:
    hw = Hardware(os_name=f"{_platform.system()} {_platform.release()}")
    hw.cpu_name = _cpu_name()

    try:
        import psutil

        hw.physical_cores = psutil.cpu_count(logical=False) or 1
        hw.logical_cores = psutil.cpu_count(logical=True) or 1
        hw.ram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
    except Exception as exc:                      # psutil missing or blocked
        log.warning("psutil probe failed: %s", exc)
        import os as _os

        hw.logical_cores = _os.cpu_count() or 1
        hw.physical_cores = max(1, hw.logical_cores // 2)

    nvidia, cuda_version = _nvidia_gpus()
    hw.gpus.extend(nvidia)
    hw.cuda_available = bool(nvidia)
    hw.cuda_version = cuda_version

    if sys.platform == "win32":
        for gpu in _windows_gpus():
            # nvidia-smi already reported real VRAM for NVIDIA cards.
            if gpu.vendor == "nvidia" and hw.nvidia:
                continue
            hw.gpus.append(gpu)

    return hw


# ---------------------------------------------------------------------------
# Turning hardware into a recommendation
# ---------------------------------------------------------------------------


@dataclass
class Recommendation:
    asr_engine: str
    asr_model: str
    dictation_model: str
    device: str
    compute_type: str
    ocr_engine: str
    diarization: bool
    speed_note: str
    reason: str


def recommend(hw: Hardware) -> Recommendation:
    """Pick sensible defaults. Always a default the user can override, never a lock.

    The ordering matters: a machine with no NVIDIA card must still land on a
    working configuration, because CPU only operation is a requirement, not a
    fallback to apologise for.
    """
    gpu = hw.nvidia
    vram = gpu.vram_gb if gpu and gpu.vram_gb else 0.0

    if gpu and vram >= 16:
        return Recommendation(
            "faster_whisper", "whisper-large-v3", "whisper-small",
            "cuda", "float16", "tesseract", True,
            "roughly 6 to 10 times faster than real time",
            f"{gpu.name} with {vram:g} GB of VRAM runs the largest model comfortably, "
            "with room for diarization alongside it.",
        )
    if gpu and vram >= 10:
        return Recommendation(
            "faster_whisper", "whisper-large-v3", "whisper-small",
            "cuda", "float16", "tesseract", True,
            "roughly 6 to 10 times faster than real time",
            f"{gpu.name} has enough VRAM ({vram:g} GB) for the full large-v3 model.",
        )
    if gpu and vram >= 5:
        return Recommendation(
            "faster_whisper", "whisper-large-v3-turbo", "whisper-small",
            "cuda", "float16", "tesseract", False,
            "roughly 8 to 12 times faster than real time",
            f"{gpu.name} has {vram:g} GB of VRAM, which suits the turbo model. "
            "Full large-v3 would be tight.",
        )
    if gpu:
        return Recommendation(
            "faster_whisper", "whisper-medium", "whisper-small",
            "cuda", "int8_float16", "tesseract", False,
            "several times faster than real time",
            f"{gpu.name} was found but reports little VRAM, so a middle sized model "
            "is the safe default.",
        )

    other = next((g for g in hw.gpus if g.vendor in ("amd", "intel")), None)
    if other:
        return Recommendation(
            "whisper_cpp", "whisper-medium", "whisper-small",
            "auto", "int8", "tesseract", False,
            "varies with the card, usually faster than CPU alone",
            f"{other.name} is not an NVIDIA card, so the whisper.cpp engine is used, "
            "which can reach the GPU through Vulkan.",
        )

    if hw.ram_gb >= 16 and hw.physical_cores >= 6:
        return Recommendation(
            "faster_whisper", "whisper-medium", "whisper-small",
            "cpu", "int8", "tesseract", False,
            "about 2 to 4 times slower than real time",
            f"No dedicated GPU, but {hw.physical_cores} cores and {hw.ram_gb:g} GB of RAM "
            "handle the medium model. Long recordings run in the background.",
        )

    return Recommendation(
        "faster_whisper", "whisper-small", "whisper-small",
        "cpu", "int8", "tesseract", False,
        "around real time",
        "No dedicated GPU and limited memory, so the small model keeps the app "
        "responsive. Accuracy on Torah terminology leans more on the dictionary here.",
    )
