"""A background queue that survives being closed.

Every job writes a small journal file the moment anything about it changes. If
Ksav is closed, crashes, or the machine loses power halfway through a three hour
shiur, the queue comes back knowing exactly which files were finished, which was
in progress, and how far it had got.

The queue is deliberately free of Qt. It runs on a plain worker thread and
reports through callbacks, so it can be tested headlessly and so the interface
can poll it rather than needing signals marshalled across threads.
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable

from ..core import paths
from ..core.logging import get

log = get(__name__)


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"
    # Started, interrupted, and picked up again on the next launch.
    INTERRUPTED = "interrupted"


ACTIVE = {JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.INTERRUPTED}


@dataclass
class Job:
    id: str
    source_path: str
    kind: str = "transcribe"
    status: str = JobStatus.QUEUED.value
    progress: float = 0.0
    message: str = "Waiting"
    duration: float = 0.0
    seconds_done: float = 0.0
    result_path: str = ""
    error: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: float = 0.0
    finished_at: float = 0.0
    options: dict = field(default_factory=dict)

    @property
    def name(self) -> str:
        return Path(self.source_path).name

    @property
    def is_active(self) -> bool:
        return JobStatus(self.status) in ACTIVE

    def eta_seconds(self) -> float | None:
        """How much longer, from how fast it has actually been going.

        A three hour recording on a laptop is a real wait. A number, even a
        rough one, is worth far more than a spinner.
        """
        if self.status != JobStatus.RUNNING.value or not self.started_at:
            return None
        elapsed = time.time() - self.started_at
        if elapsed < 5 or self.progress <= 0.02:
            return None
        return max(0.0, elapsed / self.progress - elapsed)

    def eta_label(self) -> str:
        remaining = self.eta_seconds()
        if remaining is None:
            return ""
        if remaining < 90:
            return "under a minute left"
        minutes = int(remaining // 60)
        if minutes < 60:
            return f"about {minutes} minutes left"
        hours, minutes = divmod(minutes, 60)
        return f"about {hours}h {minutes:02d}m left"


Runner = Callable[[Job, Callable[[float, float, str], None], Callable[[], bool]], str]


class JobQueue:
    """One worker, a persistent journal, and callbacks for the interface."""

    def __init__(self, runner: Runner, journal_dir: Path | None = None) -> None:
        self._runner = runner
        self._dir = Path(journal_dir) if journal_dir else paths.jobs_dir()
        self._dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, Job] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._cancelled: set[str] = set()
        self._stop = False
        self._thread: threading.Thread | None = None
        self.on_change: Callable[[Job], None] | None = None

    # -- lifecycle -------------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._work, name="ksav-jobs", daemon=True)
        self._thread.start()

    def stop(self, wait: float = 2.0) -> None:
        self._stop = True
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=wait)

    # -- queueing --------------------------------------------------------

    def add(self, source_path: Path | str, options: dict | None = None, kind: str = "transcribe") -> Job:
        job = Job(
            id=f"{int(time.time() * 1000):x}{len(self._order):02x}",
            source_path=str(source_path),
            kind=kind,
            options=options or {},
        )
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
        self._save(job)
        self._notify(job)
        self._wake.set()
        return job

    def cancel(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            self._cancelled.add(job_id)
            if job.status == JobStatus.QUEUED.value:
                job.status = JobStatus.CANCELLED.value
                job.message = "Cancelled"
        if job:
            self._save(job)
            self._notify(job)

    def remove(self, job_id: str) -> None:
        self.cancel(job_id)
        with self._lock:
            self._jobs.pop(job_id, None)
            if job_id in self._order:
                self._order.remove(job_id)
        (self._dir / f"{job_id}.json").unlink(missing_ok=True)

    def clear_finished(self) -> int:
        for job in [j for j in self.jobs() if not j.is_active]:
            self.remove(job.id)
        return len(self._order)

    # -- reading ---------------------------------------------------------

    def jobs(self) -> list[Job]:
        with self._lock:
            return [self._jobs[i] for i in self._order if i in self._jobs]

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    @property
    def active_count(self) -> int:
        return sum(1 for j in self.jobs() if j.is_active)

    # -- the journal -----------------------------------------------------

    def _save(self, job: Job) -> None:
        try:
            (self._dir / f"{job.id}.json").write_text(
                json.dumps(asdict(job), indent=2), encoding="utf-8"
            )
        except OSError as exc:
            log.warning("could not journal job %s: %s", job.id, exc)

    def restore(self) -> list[Job]:
        """Reload the queue after a restart.

        A job that was running when Ksav stopped comes back as interrupted
        rather than failed, because it can be picked up from where it got to.
        """
        restored: list[Job] = []
        for path in sorted(self._dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                job = Job(**data)
            except (OSError, ValueError, TypeError) as exc:
                log.warning("ignoring unreadable job file %s: %s", path.name, exc)
                continue
            if job.status == JobStatus.RUNNING.value:
                job.status = JobStatus.INTERRUPTED.value
                job.message = f"Interrupted at {int(job.progress * 100)} percent"
                self._save(job)
            with self._lock:
                self._jobs[job.id] = job
                if job.id not in self._order:
                    self._order.append(job.id)
            restored.append(job)
        if any(j.is_active for j in restored):
            self._wake.set()
        return restored

    # -- the worker ------------------------------------------------------

    def _next(self) -> Job | None:
        with self._lock:
            for job_id in self._order:
                job = self._jobs.get(job_id)
                if job and job.status in (JobStatus.QUEUED.value, JobStatus.INTERRUPTED.value):
                    return job
        return None

    def _work(self) -> None:
        while not self._stop:
            job = self._next()
            if job is None:
                self._wake.wait(timeout=0.5)
                self._wake.clear()
                continue
            self._run_one(job)

    def _run_one(self, job: Job) -> None:
        job.status = JobStatus.RUNNING.value
        job.started_at = time.time()
        job.message = "Starting"
        self._save(job)
        self._notify(job)

        last_saved = 0.0

        def progress(seconds_done: float, total: float, message: str) -> None:
            nonlocal last_saved
            job.seconds_done = seconds_done
            job.duration = total or job.duration
            job.progress = min(1.0, seconds_done / total) if total else 0.0
            job.message = message
            self._notify(job)
            # Journalling every segment would hammer the disk on a long
            # recording. Once a second is enough to resume usefully.
            now = time.time()
            if now - last_saved > 1.0:
                self._save(job)
                last_saved = now

        def cancelled() -> bool:
            return self._stop or job.id in self._cancelled

        try:
            job.result_path = self._runner(job, progress, cancelled)
            if cancelled():
                job.status = JobStatus.CANCELLED.value
                job.message = f"Cancelled at {int(job.progress * 100)} percent"
            else:
                job.status = JobStatus.DONE.value
                job.progress = 1.0
                job.message = "Finished"
        except Exception as exc:
            log.error("job %s failed: %s", job.id, traceback.format_exc())
            job.status = JobStatus.FAILED.value
            job.error = str(exc)
            job.message = "Did not finish"
        finally:
            job.finished_at = time.time()
            self._cancelled.discard(job.id)
            self._save(job)
            self._notify(job)

    def _notify(self, job: Job) -> None:
        if self.on_change:
            try:
                self.on_change(job)
            except Exception:
                log.exception("job listener raised")
