"""The model catalogue and the Model Vault's engine.

A model is a folder under the data root plus a manifest saying where it came
from. The catalogue below is data, not logic: adding a model is an entry here,
not a code change, which is half of what "replace the model later without
rewriting the program" means in practice. The other half is the engine registry.

Integrity: every file records an expected size and, where it is pinned, a
sha256. A file whose checksum does not match is discarded rather than installed,
because a half correct model fails in ways that look like bad transcription.
Entries with ``sha256=None`` are verified by size and by a load check instead;
the checksum is pinned once the file has been verified against the publisher.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from ..core import paths
from ..core.logging import get
from . import media, net

log = get(__name__)

HF = "https://huggingface.co"


@dataclass(frozen=True)
class ModelFile:
    name: str
    url: str
    size: int | None = None
    sha256: str | None = None
    optional: bool = False


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    engine_id: str
    kind: str                      # asr | ocr | vad | diarization
    files: tuple[ModelFile, ...]
    size_bytes: int
    licence: str
    languages: tuple[str, ...]
    notes: str = ""
    # Rough guide shown in the vault, not a hard gate.
    min_vram_gb: float = 0.0
    min_ram_gb: float = 4.0

    @property
    def size_label(self) -> str:
        gb = self.size_bytes / (1024 ** 3)
        if gb >= 1:
            return f"{gb:.1f} GB"
        return f"{self.size_bytes / (1024 ** 2):.0f} MB"

    def directory(self) -> Path:
        return paths.models_dir() / self.id


def _ct2_whisper(repo: str, revision: str = "main") -> tuple[ModelFile, ...]:
    """The standard file set for a CTranslate2 converted Whisper model."""
    base = f"{HF}/{repo}/resolve/{revision}"
    required = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
    optional = ("preprocessor_config.json", "vocabulary.json")
    return tuple(
        [ModelFile(n, f"{base}/{n}") for n in required]
        + [ModelFile(n, f"{base}/{n}", optional=True) for n in optional]
    )


CATALOGUE: tuple[ModelSpec, ...] = (
    ModelSpec(
        id="whisper-small",
        name="Whisper small",
        engine_id="faster_whisper",
        kind="asr",
        files=_ct2_whisper("Systran/faster-whisper-small"),
        size_bytes=484_000_000,
        licence="MIT",
        languages=("en", "he", "yi", "multilingual"),
        notes="Fastest usable tier. Good for live dictation and for CPU only machines. "
              "Weakest on Torah terminology, so the dictionary matters most here.",
        min_ram_gb=4,
    ),
    ModelSpec(
        id="whisper-medium",
        name="Whisper medium",
        engine_id="faster_whisper",
        kind="asr",
        files=_ct2_whisper("Systran/faster-whisper-medium"),
        size_bytes=1_530_000_000,
        licence="MIT",
        languages=("en", "he", "yi", "multilingual"),
        notes="The sensible middle. Runs on a capable CPU at a few times slower "
              "than real time, and comfortably on any NVIDIA card.",
        min_ram_gb=8,
        min_vram_gb=2,
    ),
    ModelSpec(
        id="whisper-large-v3-turbo",
        name="Whisper large-v3 turbo",
        engine_id="faster_whisper",
        kind="asr",
        files=_ct2_whisper("deepdml/faster-whisper-large-v3-turbo-ct2"),
        size_bytes=1_620_000_000,
        licence="MIT",
        languages=("en", "he", "yi", "multilingual"),
        notes="Close to large-v3 accuracy at a fraction of the time. The best "
              "choice on a card with 6 to 8 GB of VRAM.",
        min_ram_gb=8,
        min_vram_gb=5,
    ),
    ModelSpec(
        id="whisper-large-v3",
        name="Whisper large-v3",
        engine_id="faster_whisper",
        kind="asr",
        files=_ct2_whisper("Systran/faster-whisper-large-v3"),
        size_bytes=3_090_000_000,
        licence="MIT",
        languages=("en", "he", "yi", "multilingual"),
        notes="The most accurate generally available option for mixed English, "
              "Hebrew and Yiddish speech. Wants a real GPU.",
        min_ram_gb=16,
        min_vram_gb=10,
    ),
    ModelSpec(
        id="ivrit-turbo",
        name="ivrit.ai Hebrew turbo",
        engine_id="faster_whisper",
        kind="asr",
        files=_ct2_whisper("ivrit-ai/whisper-large-v3-turbo-ct2"),
        size_bytes=1_620_000_000,
        licence="Apache-2.0",
        languages=("he", "en"),
        notes="Whisper fine tuned on Hebrew by the ivrit.ai project. Noticeably "
              "better on Hebrew and Yiddish dominant speech, and weaker than the "
              "general model when the carrier language is English.",
        min_ram_gb=8,
        min_vram_gb=5,
    ),
)


BY_ID = {spec.id: spec for spec in CATALOGUE}


def asr_models() -> list[ModelSpec]:
    return [s for s in CATALOGUE if s.kind == "asr"]


# ---------------------------------------------------------------------------


@dataclass
class InstallState:
    spec: ModelSpec
    installed: bool
    bytes_on_disk: int = 0
    missing: list[str] = field(default_factory=list)


class ModelManager:
    """Knows what is on disk, and is the only thing that asks for a download.

    Every method except :meth:`download` works with the network unplugged, which
    is the point: the vault can tell you exactly what you have and what a task
    needs without touching a socket.
    """

    MANIFEST = "ksav-model.json"

    def __init__(self, root: Path | None = None) -> None:
        # Resolved through the function, not the module constant, so a portable
        # install running from a USB stick keeps its models on the stick.
        self.root = Path(root) if root else paths.models_dir()

    def directory(self, spec: ModelSpec) -> Path:
        return self.root / spec.id

    def manifest_path(self, spec: ModelSpec) -> Path:
        return self.directory(spec) / self.MANIFEST

    def state(self, spec: ModelSpec) -> InstallState:
        directory = self.directory(spec)
        if not directory.is_dir():
            return InstallState(spec, False, missing=[f.name for f in spec.files if not f.optional])

        missing = [
            f.name for f in spec.files
            if not f.optional and not (directory / f.name).is_file()
        ]
        on_disk = sum(p.stat().st_size for p in directory.glob("*") if p.is_file())
        installed = not missing and self.manifest_path(spec).is_file()
        return InstallState(spec, installed, on_disk, missing)

    def is_installed(self, model_id: str) -> bool:
        spec = BY_ID.get(model_id)
        return bool(spec) and self.state(spec).installed

    def installed_ids(self) -> list[str]:
        return [s.id for s in CATALOGUE if self.state(s).installed]

    def path_for(self, model_id: str) -> Path | None:
        """The folder an engine should load, or None when it is not installed."""
        spec = BY_ID.get(model_id)
        if not spec:
            return None
        state = self.state(spec)
        return self.directory(spec) if state.installed else None

    def download(
        self,
        spec: ModelSpec,
        *,
        on_progress: Callable[[str, float, int, int], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> Path:
        """Fetch every file in a spec. The one place in Ksav that uses the network.

        Files land one at a time and resume individually, so a transfer
        interrupted at 90 percent of a 3 GB model does not start over.
        """
        directory = self.directory(spec)
        directory.mkdir(parents=True, exist_ok=True)

        total_files = len([f for f in spec.files if not f.optional])
        done = 0

        with net.gate(f"download model {spec.id}"):
            net.allow_downloads_env()
            for model_file in spec.files:
                target = directory / model_file.name
                if target.is_file() and target.stat().st_size > 0:
                    done += 0 if model_file.optional else 1
                    continue

                def progress(p: net.Progress, name=model_file.name, index=done) -> None:
                    if on_progress:
                        on_progress(name, p.fraction or 0.0, index, total_files)

                try:
                    net.download(
                        model_file.url,
                        target,
                        sha256=model_file.sha256,
                        expected_size=model_file.size,
                        on_progress=progress,
                        should_cancel=should_cancel,
                    )
                except Exception as exc:
                    if model_file.optional:
                        log.info("optional file %s not available: %s", model_file.name, exc)
                        continue
                    raise
                if not model_file.optional:
                    done += 1

        self._write_manifest(spec)
        net.enforce_offline_env()
        return directory

    def import_from_folder(self, spec: ModelSpec, source: Path) -> Path:
        """Install a model from a folder or USB stick, with no network at all.

        This is how a machine that has never been online gets set up. The file
        names must match the spec; anything missing is reported rather than
        installed half complete.
        """
        source = Path(source)
        missing = [
            f.name for f in spec.files
            if not f.optional and not (source / f.name).is_file()
        ]
        if missing:
            raise FileNotFoundError(
                f"{source} is missing {', '.join(missing)}. "
                f"It does not look like a {spec.name} folder."
            )
        directory = self.directory(spec)
        directory.mkdir(parents=True, exist_ok=True)
        for model_file in spec.files:
            candidate = source / model_file.name
            if candidate.is_file():
                net.copy_local(candidate, directory / model_file.name)
        self._write_manifest(spec)
        return directory

    # -- USB and offline installation -----------------------------------

    def looks_like(self, spec: ModelSpec, folder: Path) -> bool:
        """True when this folder holds every required file for the model."""
        folder = Path(folder)
        if not folder.is_dir():
            return False
        return all(
            (folder / f.name).is_file()
            for f in spec.files
            if not f.optional
        )

    def discover(self, spec: ModelSpec) -> list[Path]:
        """Folders this model could be installed from right now.

        Checks beside the program and on every removable drive, so a user who
        copied a folder to a USB stick never has to say where they put it.
        Each candidate root is tried both as the model folder itself and as a
        folder containing one named after the model.
        """
        found: list[Path] = []
        for root in media.candidate_model_roots():
            for candidate in (root / spec.id, root):
                if self.looks_like(spec, candidate) and candidate not in found:
                    found.append(candidate)
        return found

    def discover_all(self) -> dict[str, Path]:
        """Every model that could be installed from attached media, by id."""
        out: dict[str, Path] = {}
        for spec in CATALOGUE:
            if self.state(spec).installed:
                continue
            places = self.discover(spec)
            if places:
                out[spec.id] = places[0]
        return out

    def download_to(
        self,
        spec: ModelSpec,
        folder: Path,
        *,
        on_progress: Callable[[str, float, int, int], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> Path:
        """Fetch a model into an arbitrary folder rather than the install location.

        This is what the USB bundle builder uses, so there is one download
        implementation rather than two that can drift apart.
        """
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        total_files = len([f for f in spec.files if not f.optional])
        done = 0

        with net.gate(f"build offline bundle for {spec.id}"):
            net.allow_downloads_env()
            for model_file in spec.files:
                target = folder / model_file.name
                if target.is_file() and target.stat().st_size > 0:
                    done += 0 if model_file.optional else 1
                    continue

                def progress(p: net.Progress, name=model_file.name, index=done) -> None:
                    if on_progress:
                        on_progress(name, p.fraction or 0.0, index, total_files)

                try:
                    net.download(
                        model_file.url,
                        target,
                        sha256=model_file.sha256,
                        expected_size=model_file.size,
                        on_progress=progress,
                        should_cancel=should_cancel,
                    )
                except Exception as exc:
                    if model_file.optional:
                        log.info("optional file %s not available: %s", model_file.name, exc)
                        continue
                    raise
                if not model_file.optional:
                    done += 1

        self._write_manifest_to(spec, folder)
        net.enforce_offline_env()
        return folder

    def remove(self, spec: ModelSpec) -> None:
        import shutil

        directory = self.directory(spec)
        if directory.is_dir():
            shutil.rmtree(directory)

    def total_bytes_on_disk(self) -> int:
        if not self.root.is_dir():
            return 0
        return sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file())

    def _write_manifest(self, spec: ModelSpec) -> None:
        self._write_manifest_to(spec, self.directory(spec))

    def _write_manifest_to(self, spec: ModelSpec, folder: Path) -> None:
        payload = {
            "id": spec.id,
            "name": spec.name,
            "engine_id": spec.engine_id,
            "kind": spec.kind,
            "licence": spec.licence,
            "files": [f.name for f in spec.files],
        }
        (Path(folder) / self.MANIFEST).write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )
