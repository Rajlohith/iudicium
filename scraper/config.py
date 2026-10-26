"""
Scraper configuration.

The constants the scraper needs (site URLs, retry limits, the case-detail
section order, ...) live in ``shared/config.json`` so the Node server and
the Python scraper always agree on them. This module just loads that file
and exposes the same names the scraper modules have always imported.

Set ``IUDICIUM_CONFIG`` to point at a different JSON file if you need to
(for example inside a container that mounts the config elsewhere).
"""

import json
import os
from pathlib import Path

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "shared" / "config.json"
_CONFIG_PATH = Path(os.environ.get("IUDICIUM_CONFIG") or _DEFAULT_PATH)

with open(_CONFIG_PATH, encoding="utf-8") as _f:
    _cfg = json.load(_f)

# Target website
SEARCH_URL = _cfg["urls"]["search"]
CASE_NUMBER_SEARCH_URL = _cfg["urls"]["caseNumberSearch"]

# Case detail sections: [(div id, section name), ...] in the site's order.
# "Case Information" (div id="H") is handled separately by case_extraction.
SECTION_ORDER = [(s["id"], s["name"]) for s in _cfg["sectionOrder"]]

NO_DATA_MARKERS = set(_cfg["noDataMarkers"])

# Report-type value -> radio button id on the search form
REPORT_TYPE_RADIO_IDS = dict(_cfg["reportTypeRadioIds"])

# Search behaviour
MAX_DATE_WINDOW_DAYS = _cfg["limits"]["maxDateWindowDays"]   # the site limits each query to 90 days
MAX_CAPTCHA_ATTEMPTS = _cfg["limits"]["maxCaptchaAttempts"]
