"""
Synthetic scraper engines, used when SCRAPER_MOCK=true.

They mimic the real engines' interface and the exact data shape they
return (base_row / case_info_structured / sections_structured / ...), so
the whole stack -- worker protocol, job manager, Excel export, React UI --
can be exercised without touching the court website or solving CAPTCHAs.
"""

import time
from datetime import timedelta

from scraper.date_utils import split_date_range


class SearchCancelled(Exception):
    pass


def mock_judges(bench):
    names = {
        "B": ["HON'BLE MR. JUSTICE A. KUMAR", "HON'BLE MRS. JUSTICE B. RAO", "HON'BLE MR. JUSTICE C. HEGDE"],
        "D": ["HON'BLE MR. JUSTICE D. PATIL", "HON'BLE MRS. JUSTICE E. NAIK"],
        "K": ["HON'BLE MR. JUSTICE F. REDDY"],
    }.get(bench, [])
    return [{"value": str(i + 1), "label": n} for i, n in enumerate(names)]


def _make_case(n, case_type="WP", year="2024", petitioner="Sri Ramesh", respondent="State of Karnataka"):
    case_no = str(10000 + n)
    case_info = {
        "kind": "fields",
        "pairs": [
            ["Case Type", case_type],
            ["Case Number", f"{case_type} {case_no}/{year}"],
            ["Status", "Disposed" if n % 2 else "Pending"],
            ["Date of Filing", f"{(n % 27) + 1:02d}-01-{year}"],
            ["Petitioner Name", petitioner],
            ["Respondent Name", respondent],
        ],
    }
    sections = {
        "Party Information": {
            "kind": "tables",
            "tables": [
                {
                    "title": "Petitioner Details",
                    "headers": ["Sl. No.", "Name", "Advocate"],
                    "rows": [{"Sl. No.": "1", "Name": petitioner, "Advocate": "Adv. S. Murthy"}],
                },
                {
                    "title": "Respondent Details",
                    "headers": ["Sl. No.", "Name", "Advocate"],
                    "rows": [
                        {"Sl. No.": "1", "Name": respondent, "Advocate": "AGA"},
                        {"Sl. No.": "2", "Name": "The Commissioner", "Advocate": "AGA"},
                    ],
                },
            ],
        },
        "Daily Orders Information": {
            "kind": "tables",
            "tables": [
                {
                    "title": "",
                    "headers": ["Order Date", "Judge", "Order"],
                    "rows": [
                        {"Order Date": f"0{(n % 8) + 1}-02-{year}", "Judge": "HON'BLE MR. JUSTICE A. KUMAR", "Order": "Notice issued."},
                        {"Order Date": f"1{(n % 8)}-03-{year}", "Judge": "HON'BLE MR. JUSTICE A. KUMAR", "Order": "Heard. Reserved for orders."},
                    ],
                }
            ],
        },
        "Prayer Information": {"kind": "narrative", "text": "Prayer: to quash the impugned order dated 01-01-2024 and to grant such other relief as this Court deems fit."},
    }
    if n % 2:
        sections["Judgment Information"] = {
            "kind": "fields",
            "pairs": [["Date of Judgment", f"20-04-{year}"], ["Disposal Nature", "Allowed"]],
        }
    flat = {name: ("\n".join(f"{k}: {v}" for k, v in s["pairs"]) if s["kind"] == "fields"
                   else s["text"] if s["kind"] == "narrative"
                   else " ".join(str(v) for t in s["tables"] for r in t["rows"] for v in r.values()))
            for name, s in sections.items()}
    return {
        "base_row": {
            "Sl. No.": str(n + 1),
            "Case Type": case_type,
            "Case No": case_no,
            "Case Year": year,
            "Petitioner V/S Respondent Name": f"{petitioner} V/S {respondent}",
        },
        "case_info_text": "\n".join(f"{k}: {v}" for k, v in case_info["pairs"]),
        "case_info_structured": case_info,
        "sections_data": flat,
        "sections_structured": sections,
        "judgment_pdf": None,
    }


class _Base:
    def __init__(self, log=print, on_progress=None, on_row_progress=None):
        self.log = log
        self.on_progress = on_progress or (lambda d, t: None)
        self.on_row_progress = on_row_progress or (lambda d, t, l: None)
        self._stop = False

    def request_stop(self):
        self._stop = True

    def _check_stop(self):
        if self._stop:
            raise SearchCancelled()

    def _sleep(self, seconds):
        # Sleep in small slices so a stop request is noticed quickly.
        end = time.time() + seconds
        while time.time() < end:
            self._check_stop()
            time.sleep(0.05)


class MockEngine(_Base):
    def run(self, aliases, overall_start, overall_end, bench_value, bench_name, *, alias_field="respondname",
            case_type=None, case_no=None, case_year=None, petitioner_name=None, respondent_name=None,
            petitioner_adv=None, respondent_adv=None, judge=None, author_judge=None, coram=None,
            report_type=None, pdf_dir=None, included_sections=None):
        ranges = split_date_range(overall_start, overall_end) if overall_start and overall_end else [(None, None)]
        jobs = [(a, r) for a in (aliases or [None]) for r in ranges]
        cases, seen, dupes, cancelled = [], set(), 0, False

        try:
            self.log(f"[mock] Opening Karnataka Judiciary website... ({bench_name})")
            self._sleep(0.4)
            for done, (alias, rng) in enumerate(jobs, start=1):
                label = alias or respondent_name or petitioner_name or case_no or "Search"
                self.log(f"[mock] Searching '{label}'" + (f" ({rng[0]:%Y-%m-%d} to {rng[1]:%Y-%m-%d})" if rng[0] else ""))
                self._sleep(0.4)
                row_total = 4
                for i in range(row_total):
                    self._check_stop()
                    self.on_row_progress(i + 1, row_total, label)
                    self._sleep(0.25)
                    # The second job re-finds one case from the first (alias overlap),
                    # to exercise duplicate handling.
                    n = i if done == 1 else (i if i == 0 else 100 * done + i)
                    ident = (case_type or "WP", str(10000 + n))
                    if ident in seen:
                        dupes += 1
                        continue
                    seen.add(ident)
                    p = petitioner_name or (alias if alias_field == "petname" else None) or "Sri Ramesh"
                    r = respondent_name or (alias if alias_field != "petname" else None) or "State of Karnataka"
                    case = _make_case(n, case_type="WP", year=str(case_year or (rng[0].year if rng[0] else 2024)),
                                      petitioner=p, respondent=r)
                    if included_sections is not None:
                        case["sections_structured"] = {k: v for k, v in case["sections_structured"].items() if k in included_sections}
                        case["sections_data"] = {k: v for k, v in case["sections_data"].items() if k in included_sections}
                        if "Case Information" not in included_sections:
                            case["case_info_structured"], case["case_info_text"] = None, ""
                    cases.append(case)
                self.on_progress(done, len(jobs))
        except SearchCancelled:
            cancelled = True
            self.log("Stop requested -- finishing up and saving what was collected so far.")

        self.log(f"Collected {len(cases)} unique case(s). Duplicates skipped: {dupes}.")
        return {"case_count": len(cases), "duplicates_skipped": dupes, "cancelled": cancelled, "cases": cases}


class MockQuickEngine(_Base):
    def run(self, bench_value, bench_name, case_type, case_no, case_year, pdf_dir=None, included_sections=None):
        cancelled, cases = False, []
        try:
            self.log(f"[mock] Opening Quick Search page ({bench_name})...")
            self._sleep(0.4)
            self.log(f"Searching Case {case_type} No. {case_no}/{case_year}...")
            self._sleep(0.5)
            if str(case_no) == "999999":
                self.log("No matching case found for that Case Type/Number/Year.")
            else:
                case = _make_case(int(case_no) % 1000, case_type="WP", year=str(case_year))
                case["base_row"]["Case No"] = str(case_no)
                cases.append(case)
            self.on_progress(1, 1)
        except SearchCancelled:
            cancelled = True
            self.log("Stop requested.")
        self.log(f"Collected {len(cases)} case(s).")
        return {"case_count": len(cases), "duplicates_skipped": 0, "cancelled": cancelled, "cases": cases}
