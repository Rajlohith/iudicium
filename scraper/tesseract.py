"""Where to find the Tesseract binary (shared by the worker and the environment check)."""

import os
import platform


def resolve_tesseract_cmd(configured=None):
    """The configured path if given; otherwise the usual install location for this OS, else None (use PATH)."""
    if configured:
        return configured
    system = platform.system()
    if system == "Windows":
        candidates = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
        ]
    elif system == "Darwin":
        candidates = ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract"]
    else:
        candidates = ["/usr/bin/tesseract", "/usr/local/bin/tesseract"]
    return next((c for c in candidates if os.path.exists(c)), None)
