"""
The roster upload: taking an existing shift plan out of a file and into the
database, with the user's confirmation in between.

The user drops a PDF, CSV or XLSX of their current plan into the chat.
``documents.py`` reduces it to a grid; this module holds that grid for the
session, lets the model say *what the grid means*, expands the meaning into
concrete assignments, and — only after the user has agreed to what was read —
writes them.

Why the split between "say what it means" and "expand it":

A roster is a big, dull table: thirty people down the side, a month across the
top, nine hundred cells. Having the model transcribe those cells into tool
arguments would be slow, expensive, and wrong in the way transcription is
always wrong — a dropped row here, a misread code there, with no way to tell.
So the model only supplies the *layout* — which column holds the names, which
row holds the dates, which month it is — perhaps a dozen numbers it reads off
the preview. The expansion from layout to nine hundred assignments happens here
in Python, exactly and identically every time.

Why the dry run:

The user asked for the interpretation to be shown before it is taken as fact,
and a count of rows is not an interpretation — "I matched 28 of your 30 people,
and these two names I could not place" is. That report comes from the backend's
own name resolution (``importShiftAssignments`` with ``dry_run``), not from a
guess here, so what is shown is precisely what would be written.

Three tools, in the order they are meant to be called:

  ``previewRosterUpload``    look at more of the grid than the upload showed
  ``interpretRosterUpload``  declare the layout; get back the dry-run report
  ``applyRosterUpload``      write it, after the user says yes
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Literal

from langchain_core.tools import StructuredTool

from shift_agent.agent.documents import ParsedDocument, Sheet, render_grid

logger = logging.getLogger(__name__)

# Uploads are held in memory only, as the chat history is: this is a staging
# area between "the user dropped a file" and "the user said yes", measured in
# minutes. Bounded so a long-running process can't accumulate them.
MAX_UPLOADS = 24
UPLOAD_TTL_SECONDS = 60 * 60 * 6

# The backend operation the writes go through, exposed by the MCP server from
# api/openapi.yaml. Named here so the failure is one clear error if the spec
# ever renames it.
IMPORT_TOOL = "importShiftAssignments"

# How many assignments one upload may produce. A year of daily shifts for a
# large ward is well under this; anything above it is a misread layout — a date
# row pointed at the wrong row, say, turning every cell into an assignment.
MAX_ASSIGNMENTS = 5000


@dataclass
class Layout:
    """What the model read the grid as. See ``interpret_upload`` for the fields."""

    style: str
    sheet: int = 0
    employee_column: int = 0
    first_data_row: int = 1
    # matrix
    date_row: int = 0
    first_date_column: int = 1
    last_date_column: int | None = None
    year: int | None = None
    month: int | None = None
    # list
    date_column: int = 1
    shift_column: int = 2
    ignore_codes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


@dataclass
class Upload:
    upload_id: str
    session_id: str
    document: ParsedDocument
    created_at: float
    layout: Layout | None = None
    assignments: list[dict] = field(default_factory=list)


class UploadStore:
    """Staged uploads, bounded and expiring.

    Keyed by ``upload_id`` rather than by session, so one conversation can hold
    more than one file. What keeps a session out of another's upload is that the
    id is random and only ever appears in the history of the session it was
    staged for — the model cannot reach an upload it was never told about. The
    ``session_id`` is recorded for logging and for narrowing a stale-upload
    report, not as an access check.
    """

    def __init__(self) -> None:
        self._items: OrderedDict[str, Upload] = OrderedDict()
        self._lock = threading.Lock()

    def add(self, session_id: str, document: ParsedDocument) -> Upload:
        upload = Upload(
            upload_id=uuid.uuid4().hex[:12],
            session_id=session_id,
            document=document,
            created_at=time.time(),
        )
        with self._lock:
            self._expire()
            self._items[upload.upload_id] = upload
            while len(self._items) > MAX_UPLOADS:
                self._items.popitem(last=False)
        return upload

    def get(self, upload_id: str) -> Upload | None:
        with self._lock:
            self._expire()
            upload = self._items.get(upload_id)
            if upload is not None:
                self._items.move_to_end(upload_id)
            return upload

    def _expire(self) -> None:
        cutoff = time.time() - UPLOAD_TTL_SECONDS
        for key in [k for k, v in self._items.items() if v.created_at < cutoff]:
            del self._items[key]


# One store for the process, like the graph and its checkpointer.
store = UploadStore()


# ---------------------------------------------------------------------------
# Reading the grid
# ---------------------------------------------------------------------------


def _sheet(upload: Upload, index: int) -> Sheet:
    sheets = upload.document.sheets
    if not 0 <= index < len(sheets):
        raise ValueError(
            f"Sheet {index} does not exist — the file has {len(sheets)} "
            f"(0–{len(sheets) - 1})."
        )
    return sheets[index]


def describe_upload(upload: Upload, *, max_rows: int = 25, max_cols: int = 40) -> str:
    """The message the model first sees: what the file is, plus a look at it."""
    doc = upload.document
    parts = [
        f"Uploaded file: {doc.filename} ({doc.kind}), upload_id: {upload.upload_id}",
        f"Sheets: {len(doc.sheets)}",
    ]
    for index, sheet in enumerate(doc.sheets):
        note = " — columns are an approximate split of text lines" if sheet.approximate else ""
        parts.append(
            f"\n[sheet {index}] '{sheet.name}' — {sheet.height} row(s) × {sheet.width} column(s){note}\n"
            + render_grid(sheet, max_rows=max_rows, max_cols=max_cols)
        )
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Layout -> assignments
# ---------------------------------------------------------------------------

_DAY_ONLY = re.compile(r"^(\d{1,2})\b")
_ISO_DATE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})")
_DMY_DATE = re.compile(r"^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?")


def _header_date(cell: str, year: int | None, month: int | None) -> date | None:
    """The date a matrix column header stands for, or None if it isn't one.

    Roster headers are written every which way — "1", "Mo 1", "01.09.", "Sep 1",
    "2026-09-01". The year and month the model supplies fill in whatever the
    header leaves out, which for a monthly plan is usually both.
    """
    cell = cell.strip()
    if not cell:
        return None

    iso = _ISO_DATE.search(cell)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None

    dmy = _DMY_DATE.match(cell)
    if dmy and dmy.group(2):
        day, mon = int(dmy.group(1)), int(dmy.group(2))
        raw_year = dmy.group(3)
        if raw_year:
            yr = int(raw_year)
            yr += 2000 if yr < 100 else 0
        elif year:
            yr = year
        else:
            return None
        try:
            return date(yr, mon, day)
        except ValueError:
            return None

    # A bare day number, which only means something with a month and year.
    if year and month:
        day_match = _DAY_ONLY.search(cell)
        if day_match:
            try:
                return date(year, month, int(day_match.group(1)))
            except ValueError:
                return None
    return None


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if 0 <= index < len(row) else ""


def expand(upload: Upload, layout: Layout) -> tuple[list[dict], list[str]]:
    """Turn the grid plus a layout into assignment rows.

    Returns the rows and a list of human-readable notes about what was skipped
    — an unreadable date header, a row with no name — so the model can mention
    them rather than silently losing part of the plan.
    """
    sheet = _sheet(upload, layout.sheet)
    ignore = {code.strip().lower() for code in layout.ignore_codes if code.strip()}
    assignments: list[dict] = []
    notes: list[str] = []

    if layout.style == "matrix":
        if not 0 <= layout.date_row < sheet.height:
            raise ValueError(f"date_row {layout.date_row} is outside the sheet (0–{sheet.height - 1}).")

        header = sheet.rows[layout.date_row]
        last_col = layout.last_date_column
        if last_col is None:
            last_col = max(sheet.width, len(header)) - 1

        columns: list[tuple[int, date]] = []
        unreadable: list[str] = []
        for col in range(layout.first_date_column, last_col + 1):
            raw = _cell(header, col)
            if not raw:
                continue
            resolved = _header_date(raw, layout.year, layout.month)
            if resolved is None:
                unreadable.append(f"c{col}='{raw}'")
            else:
                columns.append((col, resolved))
        if unreadable:
            notes.append(
                "Column headers not read as dates and therefore ignored: "
                + ", ".join(unreadable[:12])
                + ("…" if len(unreadable) > 12 else "")
            )
        if not columns:
            raise ValueError(
                "No date columns could be resolved. Check date_row, "
                "first_date_column, and that year and month are set when the "
                "headers are bare day numbers."
            )

        for row_index in range(layout.first_data_row, sheet.height):
            row = sheet.rows[row_index]
            employee = _cell(row, layout.employee_column)
            if not employee:
                continue
            for col, day in columns:
                code = _cell(row, col)
                if not code or code.lower() in ignore:
                    continue
                assignments.append(
                    {"employee": employee, "shift": code, "date": day.isoformat()}
                )

    elif layout.style == "list":
        for row_index in range(layout.first_data_row, sheet.height):
            row = sheet.rows[row_index]
            employee = _cell(row, layout.employee_column)
            raw_date = _cell(row, layout.date_column)
            code = _cell(row, layout.shift_column)
            if not employee and not raw_date and not code:
                continue
            if not employee or not raw_date or not code:
                notes.append(f"Row {row_index} skipped — missing employee, date or shift.")
                continue
            if code.lower() in ignore:
                continue
            resolved = _header_date(raw_date, layout.year, layout.month)
            if resolved is None:
                notes.append(f"Row {row_index} skipped — unreadable date '{raw_date}'.")
                continue
            assignments.append(
                {"employee": employee, "shift": code, "date": resolved.isoformat()}
            )
    else:
        raise ValueError(f"Unknown layout style '{layout.style}' — use 'matrix' or 'list'.")

    if not assignments:
        raise ValueError(
            "The layout produced no assignments. Check first_data_row and "
            "employee_column against the preview."
        )
    if len(assignments) > MAX_ASSIGNMENTS:
        raise ValueError(
            f"The layout produced {len(assignments)} assignments, over the "
            f"{MAX_ASSIGNMENTS} limit. That usually means a row or column index "
            f"is off — check the preview again."
        )
    return assignments, notes


def summarise(assignments: list[dict], notes: list[str], report: dict) -> dict:
    """The interpretation, as the model should relay it to the user.

    Deliberately not the raw rows: nine hundred of them would swamp the reply
    and tell the user nothing they can check. What they *can* check is the
    shape — the date range, who was found, which codes mapped to which shifts,
    and what did not resolve.
    """
    dates = sorted({a["date"] for a in assignments})
    per_employee: dict[str, int] = {}
    per_shift: dict[str, int] = {}
    for a in assignments:
        per_employee[a["employee"]] = per_employee.get(a["employee"], 0) + 1
        per_shift[a["shift"]] = per_shift.get(a["shift"], 0) + 1

    return {
        "assignments_read": len(assignments),
        "date_range": {"from": dates[0], "to": dates[-1]} if dates else None,
        "days_covered": len(dates),
        "people_read": len(per_employee),
        "shifts_per_employee": per_employee,
        "shift_code_counts": per_shift,
        "parse_notes": notes,
        "backend_check": report,
    }


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


def _call_import(
    call_mcp: Callable[[str, dict], str],
    assignments: list[dict],
    *,
    dry_run: bool,
    replace_existing: bool,
) -> dict:
    """Run the backend import and return its report as a dict."""
    raw = call_mcp(
        IMPORT_TOOL,
        {
            "assignments": assignments,
            "dry_run": dry_run,
            "replace_existing": replace_existing,
        },
    )
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {"error": f"Unreadable response from {IMPORT_TOOL}: {raw[:500]}"}


def build_roster_tools(call_mcp: Callable[[str, dict], str]) -> list[StructuredTool]:
    """The roster upload tools.

    Args:
        call_mcp: synchronous ``(tool_name, arguments) -> text`` against the MCP
            server. Injected rather than imported so the writes still go through
            MCP, as every other backend call does, without this module holding
            an MCP client of its own.
    """

    def _load(upload_id: str) -> Upload:
        upload = store.get(upload_id)
        if upload is None:
            raise ValueError(
                f"No upload '{upload_id}' — it may have expired. Ask the user to attach the file again."
            )
        return upload

    def preview_roster_upload(
        upload_id: str,
        sheet: int = 0,
        first_row: int = 0,
        max_rows: int = 30,
        max_cols: int = 40,
    ) -> str:
        try:
            upload = _load(upload_id)
            target = _sheet(upload, sheet)
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps(
            {
                "upload_id": upload_id,
                "sheet": sheet,
                "sheet_name": target.name,
                "rows": target.height,
                "columns": target.width,
                "approximate_columns": target.approximate,
                "grid": render_grid(
                    target,
                    first_row=max(0, first_row),
                    max_rows=max(1, min(max_rows, 120)),
                    max_cols=max(1, min(max_cols, 80)),
                ),
            },
            indent=2,
        )

    def interpret_roster_upload(
        upload_id: str,
        style: Literal["matrix", "list"],
        sheet: int = 0,
        employee_column: int = 0,
        first_data_row: int = 1,
        date_row: int = 0,
        first_date_column: int = 1,
        last_date_column: int | None = None,
        year: int | None = None,
        month: int | None = None,
        date_column: int = 1,
        shift_column: int = 2,
        ignore_codes: list[str] | None = None,
    ) -> str:
        layout = Layout(
            style=style.strip().lower(),
            sheet=sheet,
            employee_column=employee_column,
            first_data_row=first_data_row,
            date_row=date_row,
            first_date_column=first_date_column,
            last_date_column=last_date_column,
            year=year,
            month=month,
            date_column=date_column,
            shift_column=shift_column,
            ignore_codes=ignore_codes or [],
        )
        try:
            upload = _load(upload_id)
            assignments, notes = expand(upload, layout)
        except ValueError as exc:
            return json.dumps({"error": str(exc)})

        report = _call_import(call_mcp, assignments, dry_run=True, replace_existing=False)
        # Staged, not written: applyRosterUpload replays exactly these rows, so
        # what the user agrees to is what lands.
        upload.layout = layout
        upload.assignments = assignments

        result = summarise(assignments, notes, report)
        result["upload_id"] = upload_id
        result["layout"] = layout.as_dict()
        result["written"] = False
        result["next_step"] = (
            "Show the user what was read — date range, how many people and "
            "assignments, which codes mapped to which shifts, and anything "
            "unmatched — then ask whether to take it as their shift "
            "assignments. Call applyRosterUpload only after they say yes."
        )
        return json.dumps(result, indent=2)

    def apply_roster_upload(upload_id: str, replace_existing: bool = False) -> str:
        try:
            upload = _load(upload_id)
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        if not upload.assignments:
            return json.dumps(
                {"error": "Nothing staged for this upload — call interpretRosterUpload first."}
            )

        report = _call_import(
            call_mcp, upload.assignments, dry_run=False, replace_existing=replace_existing
        )
        logger.info(
            "Roster upload %s applied — %s of %s row(s) created",
            upload_id,
            report.get("created"),
            len(upload.assignments),
        )
        return json.dumps({"upload_id": upload_id, "written": True, "result": report}, indent=2)

    return [
        StructuredTool.from_function(
            func=preview_roster_upload,
            name="previewRosterUpload",
            description=(
                "Look at more of an uploaded roster file's grid. The upload message "
                "already shows the first rows of every sheet; use this to scroll "
                "further down a long file, look at a wider slice, or inspect another "
                "sheet before deciding on the layout. Rows and columns are indexed "
                "from 0, and those indices are what interpretRosterUpload expects."
            ),
        ),
        StructuredTool.from_function(
            func=interpret_roster_upload,
            name="interpretRosterUpload",
            description=(
                "Say how an uploaded roster file is laid out, and get back what it "
                "would import — WITHOUT writing anything. Always call this before "
                "applyRosterUpload, and show the user the result.\n"
                "\n"
                "style='matrix': one row per person, one column per day (the usual "
                "monthly plan). Set employee_column, date_row (the row holding the "
                "day numbers or dates), first_data_row, first_date_column, "
                "optionally last_date_column, and year+month when the headers are "
                "bare day numbers like '1', '2', 'Mo 3'.\n"
                "style='list': one row per assignment. Set employee_column, "
                "date_column, shift_column and first_data_row.\n"
                "\n"
                "ignore_codes lists cell values that do NOT mean a shift — a day-off "
                "marker such as '-', 'X', 'free', 'U' for holiday. Anything else in a "
                "cell is taken as a shift name or short code.\n"
                "\n"
                "The result reports the date range, how many people and assignments "
                "were read, how each shift code and each name resolved against the "
                "backend, and what matched nothing."
            ),
        ),
        StructuredTool.from_function(
            func=apply_roster_upload,
            name="applyRosterUpload",
            description=(
                "Write the assignments staged by interpretRosterUpload to the "
                "database as fixed shift assignments. Call this ONLY after showing "
                "the user the interpretation and getting an explicit yes. Rows that "
                "matched nothing are skipped, not guessed at. Set replace_existing "
                "to overwrite assignments those employees already have on the same "
                "dates — otherwise those rows are reported as conflicts and left "
                "alone."
            ),
        ),
    ]
