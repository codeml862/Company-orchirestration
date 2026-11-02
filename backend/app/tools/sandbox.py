"""Sandboxed Python execution for agents (tests, data analysis).

Backends:
* docker (default, required for production): throwaway container with no network,
  read-only root filesystem, memory/CPU/PID limits, non-root user, and only the task's files.
* subprocess (development only): isolated interpreter in a temp dir with an empty
  environment (no secrets) and CPU/memory/file-size rlimits (on Windows: a Job Object with a
  memory and process cap, killed when the run ends). It is NOT a security boundary against
  hostile code; the platform refuses to use it when AICO_ENV=production.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path, PurePosixPath

from app.config import Settings

MAX_OUTPUT_CHARS = 12000
MAX_FILES = 50
MAX_TOTAL_BYTES = 2_000_000


class SandboxError(Exception):
    pass


def _safe_relative(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts or name.startswith("~"):
        raise SandboxError(f"invalid file name {name!r}: use a relative path without '..'")
    return path


def _prepare_workdir(code: str, files: dict[str, str]) -> Path:
    if len(files) > MAX_FILES:
        raise SandboxError(f"too many files (max {MAX_FILES})")
    total = len(code.encode()) + sum(len(v.encode()) for v in files.values())
    if total > MAX_TOTAL_BYTES:
        raise SandboxError("files too large for the sandbox")
    workdir = Path(tempfile.mkdtemp(prefix="aico-sbx-"))
    for name, content in files.items():
        target = workdir / _safe_relative(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    (workdir / "main.py").write_text(code, encoding="utf-8")
    os.chmod(workdir, 0o777)
    for p in workdir.rglob("*"):
        os.chmod(p, 0o777 if p.is_dir() else 0o666)
    return workdir


def _truncate(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    half = MAX_OUTPUT_CHARS // 2
    return text[:half] + f"\n... [{len(text) - MAX_OUTPUT_CHARS} chars truncated] ...\n" + text[-half:]


def run_python(*, code: str, files: dict[str, str], settings: Settings, timeout: int) -> dict:
    backend = settings.sandbox_backend
    if backend == "subprocess" and settings.env == "production":
        raise SandboxError("the subprocess sandbox is disabled in production; configure the docker backend")
    workdir = _prepare_workdir(code, files)
    try:
        started = time.monotonic()
        if backend == "docker":
            result = _run_docker(workdir, settings, timeout)
        elif backend == "subprocess":
            result = _run_subprocess(workdir, settings, timeout)
        else:
            raise SandboxError(f"unknown sandbox backend {backend!r}")
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        result["backend"] = backend
        return result
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _completed(proc_stdout: bytes, proc_stderr: bytes, code: int, timed_out: bool) -> dict:
    return {
        "exit_code": code,
        "timed_out": timed_out,
        "stdout": _truncate(proc_stdout.decode("utf-8", errors="replace")),
        "stderr": _truncate(proc_stderr.decode("utf-8", errors="replace")),
    }


def _run_docker(workdir: Path, settings: Settings, timeout: int) -> dict:
    if shutil.which("docker") is None:
        raise SandboxError("docker is not installed; cannot run sandboxed code")
    name = f"aico-sbx-{uuid.uuid4().hex[:12]}"
    cmd = [
        "docker", "run", "--rm", "--name", name,
        "--network", "none",
        "--memory", f"{settings.sandbox_memory_mb}m",
        "--memory-swap", f"{settings.sandbox_memory_mb}m",
        "--cpus", "1",
        "--pids-limit", "128",
        "--read-only",
        "--tmpfs", "/tmp:rw,size=64m",
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        "--user", "65534:65534",
        "-v", f"{workdir}:/work:rw",
        "-w", "/work",
        "-e", "PYTHONDONTWRITEBYTECODE=1",
        settings.sandbox_image,
        "python", "-E", "-s", "main.py",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout + 15)
    except subprocess.TimeoutExpired as exc:
        subprocess.run(["docker", "kill", name], capture_output=True)
        return _completed(exc.stdout or b"", exc.stderr or b"", -1, True)
    if proc.returncode == 125:  # docker itself failed (daemon down, image missing...)
        raise SandboxError("sandbox unavailable: " + proc.stderr.decode(errors="replace")[:500])
    return _completed(proc.stdout, proc.stderr, proc.returncode, False)


def _limit_resources(memory_mb: int, cpu_seconds: int):
    def apply():
        import resource

        os.setsid()
        mem = memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        resource.setrlimit(resource.RLIMIT_FSIZE, (50 * 1024 * 1024, 50 * 1024 * 1024))

    return apply


def _windows_job(memory_mb: int):
    """A Job Object that caps the process's memory and kills it when the handle is closed."""
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class BASIC_LIMITS(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class EXTENDED_LIMITS(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC_LIMITS),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    job = kernel32.CreateJobObjectW(None, None)
    limits = EXTENDED_LIMITS()
    # JOB_OBJECT_LIMIT_ACTIVE_PROCESS | PROCESS_MEMORY | KILL_ON_JOB_CLOSE
    limits.BasicLimitInformation.LimitFlags = 0x8 | 0x100 | 0x2000
    limits.BasicLimitInformation.ActiveProcessLimit = 32
    limits.ProcessMemoryLimit = memory_mb * 1024 * 1024
    kernel32.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits))  # ExtendedLimitInformation
    return kernel32, job


def _run_subprocess_windows(workdir: Path, settings: Settings, timeout: int) -> dict:
    # SYSTEMROOT is required for Python to start on Windows; nothing else from the host environment.
    env = {
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", r"C:\Windows"),
        "PATH": str(Path(sys.executable).parent),
        "TEMP": str(workdir),
        "TMP": str(workdir),
        "USERPROFILE": str(workdir),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUTF8": "1",
    }
    kernel32, job = _windows_job(max(settings.sandbox_memory_mb, 256))
    try:
        proc = subprocess.Popen(
            [sys.executable, "-E", "-s", "-X", "utf8", "main.py"],  # -E ignores PYTHONUTF8, hence -X
            cwd=workdir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        kernel32.AssignProcessToJobObject(job, int(proc._handle))
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, err = proc.communicate()
            return _completed(out, err, -1, True)
        return _completed(out, err, proc.returncode, False)
    finally:
        kernel32.CloseHandle(job)  # kills anything the code left running


def _run_subprocess(workdir: Path, settings: Settings, timeout: int) -> dict:
    if sys.platform == "win32":
        return _run_subprocess_windows(workdir, settings, timeout)
    env = {"PATH": "/usr/bin:/bin", "HOME": str(workdir), "PYTHONDONTWRITEBYTECODE": "1", "LANG": "C.UTF-8"}
    try:
        proc = subprocess.run(
            [sys.executable, "-E", "-s", "main.py"],
            cwd=workdir,
            env=env,
            capture_output=True,
            timeout=timeout,
            preexec_fn=_limit_resources(max(settings.sandbox_memory_mb, 256), timeout + 1),
        )
    except subprocess.TimeoutExpired as exc:
        return _completed(exc.stdout or b"", exc.stderr or b"", -1, True)
    return _completed(proc.stdout, proc.stderr, proc.returncode, False)
