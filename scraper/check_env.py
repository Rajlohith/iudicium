"""
Environment check: can this Python actually run the scraper?

    python -m scraper.check_env [tesseract_cmd]

Prints one JSON object on stdout:
    {"ok": bool, "python": "...", "version": "3.13.0", "problems": ["..."], ...}

The Node server runs this before starting a search (and at startup), so a
missing package, a missing browser or a missing Tesseract is reported
plainly instead of surfacing as a mysterious failure mid-search.
"""

import json
import os
import sys

from scraper.tesseract import resolve_tesseract_cmd


def check(tesseract_cmd=None):
    exe = sys.executable
    report = {
        "python": exe,
        "version": sys.version.split()[0],
        "modules": {},
        "chromium": None,
        "tesseract": None,
        "problems": [],
    }
    problems = report["problems"]

    # 1. Python packages
    missing = []
    for name, pip_name in (("playwright", "playwright"), ("pytesseract", "pytesseract"), ("PIL", "Pillow")):
        try:
            __import__(name)
            report["modules"][name] = True
        except Exception as e:  # noqa: BLE001 -- any import failure means "not usable"
            report["modules"][name] = False
            missing.append(pip_name)
            report.setdefault("import_errors", {})[name] = f"{type(e).__name__}: {e}"
    if missing:
        problems.append(
            f"This Python ({exe}) is missing: {', '.join(missing)}. "
            f"Install them with:  \"{exe}\" -m pip install -r requirements.txt   "
            "(or set PYTHON_BIN in .env to the Python where you installed them)."
        )

    # 2. Playwright's Chromium
    if report["modules"].get("playwright"):
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                path = p.chromium.executable_path
            report["chromium"] = bool(path and os.path.exists(path))
        except Exception as e:  # noqa: BLE001
            report["chromium"] = False
            report.setdefault("import_errors", {})["playwright_driver"] = f"{type(e).__name__}: {e}"
        if not report["chromium"]:
            problems.append(
                f"Playwright's Chromium browser is not installed for this Python. Run:  \"{exe}\" -m playwright install chromium"
            )

    # 3. Tesseract OCR (solves the CAPTCHA)
    if report["modules"].get("pytesseract"):
        import pytesseract

        cmd = resolve_tesseract_cmd(tesseract_cmd)
        report["tesseract_cmd"] = cmd or "(PATH)"
        if cmd:
            pytesseract.pytesseract.tesseract_cmd = cmd
        try:
            report["tesseract"] = str(pytesseract.get_tesseract_version())
        except Exception as e:  # noqa: BLE001
            report["tesseract"] = None
            problems.append(
                "Tesseract OCR was not found, so the CAPTCHA can't be solved. Install it "
                "(Windows: https://github.com/UB-Mannheim/tesseract/wiki) and, if it's not on PATH, "
                f"set TESSERACT_CMD in .env to the full path of tesseract.exe. ({type(e).__name__})"
            )

    report["ok"] = not problems
    return report


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    print(json.dumps(check(arg), ensure_ascii=False))
