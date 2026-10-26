"""
Scraper worker -- the only Python entry point the Node server talks to.

The Node/Express backend owns the web server, the job queue, the AI
assistant and the Excel export. This process owns the one thing that
needs Python: driving the court website with Playwright and solving its
CAPTCHA with Tesseract.

Run it from the project root:

    python -u -m scraper.worker <mode> <spec.json>      # mode: detailed | quick | judges

Protocol
--------
spec file   A JSON file written by the server (path = 2nd argument) with
            the job's parameters, plus:
                stop_file   -- if this file appears, the run winds down
                               early and saves what it has collected
                parent_pid  -- if that process disappears (the server
                               died), the run stops too, so a scraper is
                               never left running unattended

stdin       Not used. (Earlier versions kept a thread blocked on stdin to
            receive a stop command; polling a file instead avoids any
            interaction between that blocked read and the browser launch.)

stdout      One JSON object per line -- "events". Nothing else is ever
            written to stdout (stray prints from libraries are redirected
            to stderr):

                {"type": "log",           "payload": "<text>"}
                {"type": "progress",      "payload": {"done": 1, "total": 3}}
                {"type": "case_progress", "payload": {"done": 4, "total": 20, "label": "Infosys"}}
                {"type": "result",        "payload": {...}}   # exactly once, on success
                {"type": "error",         "payload": "<message>"}

stderr      Free-form diagnostics (Playwright warnings, tracebacks).

Exit code is 0 when the run finished or was cancelled, 1 on failure.

Set SCRAPER_MOCK=true to run against synthetic data instead of the live
site -- handy for working on the UI without solving real CAPTCHAs.
"""

import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

from scraper.tesseract import resolve_tesseract_cmd

# ---------------------------------------------------------------------
# stdout is reserved for protocol events. Keep a private handle to it
# and point sys.stdout at stderr so a stray print() can't corrupt it.
# ---------------------------------------------------------------------
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover - older/unusual streams
        pass

_proto = sys.stdout
sys.stdout = sys.stderr
_emit_lock = threading.Lock()


def emit(event_type, payload):
    line = json.dumps({"type": event_type, "payload": payload}, ensure_ascii=False)
    with _emit_lock:
        _proto.write(line + "\n")
        _proto.flush()


def log(message):
    emit("log", str(message))


# ---------------------------------------------------------------------
# Stop handling: no blocking reads, just cheap polling
# ---------------------------------------------------------------------

def parent_alive(pid):
    """Is the process that started us still running? (True when unknown.)"""
    if not pid:
        return True
    try:
        if os.name == "nt":
            import ctypes

            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x00100000, False, int(pid))  # SYNCHRONIZE
            if not handle:
                return False
            try:
                return kernel32.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT -> still running
            finally:
                kernel32.CloseHandle(handle)
        os.kill(int(pid), 0)  # signal 0 only checks existence on POSIX
        return True
    except ProcessLookupError:
        return False
    except Exception:  # noqa: BLE001 -- when in doubt, keep running
        return True


class StopWatcher(threading.Thread):
    """Sets the stop flag when the stop file appears or the parent process is gone."""

    def __init__(self, stop_file, parent_pid):
        super().__init__(daemon=True)
        self.stop_file = stop_file
        self.parent_pid = parent_pid
        self.stop_event = threading.Event()
        self._targets = []

    def attach(self, engine):
        self._targets.append(engine)
        if self.stop_event.is_set():
            engine.request_stop()

    def _trigger(self):
        self.stop_event.set()
        for target in self._targets:
            target.request_stop()

    def run(self):
        ticks = 0
        while not self.stop_event.is_set():
            if self.stop_file and os.path.exists(self.stop_file):
                self._trigger()
                return
            ticks += 1
            if ticks % 8 == 0 and not parent_alive(self.parent_pid):  # every ~2s
                self._trigger()
                return
            time.sleep(0.25)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _as_section_set(included_sections):
    """None -> no filter (everything). An explicit list, even an empty
    one, is a real selection: the person deselected those sections."""
    if included_sections is None:
        return None
    return set(included_sections)


def _blank_to_none(value):
    return value or None


def _write_result(spec, summary):
    """Cases can be large; hand them over as a file instead of one huge line."""
    result_path = Path(spec["result_path"])
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(
        json.dumps(summary["cases"], ensure_ascii=False), encoding="utf-8"
    )
    emit(
        "result",
        {
            "result_path": str(result_path),
            "case_count": summary["case_count"],
            "duplicates_skipped": summary["duplicates_skipped"],
            "cancelled": summary["cancelled"],
        },
    )


def _mock():
    return os.environ.get("SCRAPER_MOCK", "").lower() == "true"


# ---------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------

def detailed_job(spec, watcher):
    from scraper.date_utils import parse_user_date

    on_progress = lambda done, total: emit("progress", {"done": done, "total": total})
    on_row_progress = lambda done, total, label: emit(
        "case_progress", {"done": done, "total": total, "label": label}
    )

    if _mock():
        from scraper.mock import MockEngine
        engine = MockEngine(log=log, on_progress=on_progress, on_row_progress=on_row_progress)
    else:
        log("Loading the scraper...")
        from scraper.search_engine import SearchEngine
        engine = SearchEngine(
            log=log,
            on_progress=on_progress,
            on_row_progress=on_row_progress,
            tesseract_cmd=resolve_tesseract_cmd(spec.get("tesseract_cmd")),
            headless=spec.get("headless", True),
            debug_dir=spec.get("debug_dir"),
        )
    watcher.attach(engine)

    from_date = parse_user_date(spec["from_date"]) if spec.get("from_date") else None
    to_date = parse_user_date(spec["to_date"]) if spec.get("to_date") else None

    summary = engine.run(
        spec.get("aliases") or [],
        from_date,
        to_date,
        spec["db_bench"],
        spec.get("bench_name") or spec["db_bench"],
        alias_field=spec.get("alias_field") or "respondname",
        case_type=_blank_to_none(spec.get("case_type")),
        case_no=_blank_to_none(spec.get("case_no")),
        case_year=_blank_to_none(spec.get("case_year")),
        petitioner_name=_blank_to_none(spec.get("petitioner_name")),
        respondent_name=_blank_to_none(spec.get("respondent_name")),
        petitioner_adv=_blank_to_none(spec.get("petitioner_adv")),
        respondent_adv=_blank_to_none(spec.get("respondent_adv")),
        judge=_blank_to_none(spec.get("judge")),
        author_judge=_blank_to_none(spec.get("author_judge")),
        coram=_blank_to_none(spec.get("coram")),
        report_type=_blank_to_none(spec.get("report_type")),
        pdf_dir=Path(spec["pdf_dir"]) if spec.get("pdf_dir") else None,
        included_sections=_as_section_set(spec.get("included_sections")),
    )
    _write_result(spec, summary)


def quick_job(spec, watcher):
    on_progress = lambda done, total: emit("progress", {"done": done, "total": total})

    if _mock():
        from scraper.mock import MockQuickEngine
        engine = MockQuickEngine(log=log, on_progress=on_progress)
    else:
        log("Loading the scraper...")
        from scraper.case_number_search import CaseNumberSearchEngine
        engine = CaseNumberSearchEngine(
            log=log,
            on_progress=on_progress,
            tesseract_cmd=resolve_tesseract_cmd(spec.get("tesseract_cmd")),
            headless=spec.get("headless", True),
            debug_dir=spec.get("debug_dir"),
        )
    watcher.attach(engine)

    summary = engine.run(
        spec["db_bench"],
        spec.get("bench_name") or spec["db_bench"],
        spec["case_type"],
        spec["case_no"],
        spec["case_year"],
        pdf_dir=Path(spec["pdf_dir"]) if spec.get("pdf_dir") else None,
        included_sections=_as_section_set(spec.get("included_sections")),
    )
    _write_result(spec, summary)


def judges_job(spec, watcher):
    if _mock():
        from scraper.mock import mock_judges
        judges = mock_judges(spec["db_bench"])
    else:
        from scraper.judge_lookup import fetch_judge_options
        judges = fetch_judge_options(spec["db_bench"], headless=spec.get("headless", True))
    emit("result", {"judges": judges})


JOBS = {"detailed": detailed_job, "quick": quick_job, "judges": judges_job}


def main(argv):
    if len(argv) != 3 or argv[1] not in JOBS:
        emit("error", f"usage: python -m scraper.worker {{{'|'.join(JOBS)}}} <spec.json>")
        return 1

    try:
        spec = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        emit("error", f"could not read the job spec {argv[2]}: {e}")
        return 1

    # First sign of life: if the person sees this, Python started and the spec was read.
    log(f"Scraper started (Python {sys.version.split()[0]}, pid {os.getpid()}).")

    watcher = StopWatcher(spec.get("stop_file"), spec.get("parent_pid"))
    watcher.start()

    try:
        JOBS[argv[1]](spec, watcher)
    except Exception as e:  # noqa: BLE001 -- reported to the server, not swallowed
        traceback.print_exc(file=sys.stderr)
        emit("error", str(e) or e.__class__.__name__)
        return 1
    finally:
        watcher.stop_event.set()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
