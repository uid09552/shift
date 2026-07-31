#!/usr/bin/env python3
"""
Hospital Shift Management — Seed Script v2
==========================================
Generates realistic test data via REST API:
  - 5 shifts: Frühschicht, Normalschicht, Spätschicht, Nachtschicht, Rufdienst
  - 10 capabilities (hospital specialisations)
  - 40 employees in 5 workstation-aligned groups (8 per workstation)
  - 5 workstations (hospital departments)
  - Capability assignment: each employee gets ALL capabilities required by their
    primary workstation so the CP-SAT optimizer can create valid assignments.
  - Shift availability: group-appropriate (e.g. ICU staff can work nights).
  - Vacation blocks + sick-day unavailabilities (future)
  - Random shift wishes (future dates, considered by the optimizer)
  - Confirmed shift plans covering the past 3 months

Usage:
  pip install requests
  python3 seed_data_v2.py [BASE_URL]
  Default BASE_URL: http://127.0.0.1:8081/api/v1
"""

import sys
import random
from datetime import date, timedelta
from itertools import groupby

import requests

# ─── Config ───────────────────────────────────────────────────────────────────
BASE_URL = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8081/api/v1"
random.seed(42)  # reproducible runs

TODAY = date(2026, 6, 28)
PERIOD_START = TODAY - timedelta(days=92)   # 2026-03-28
PERIOD_END   = TODAY - timedelta(days=1)    # 2026-06-27

HOLIDAYS = {
    date(2026, 4, 3),   # Karfreitag
    date(2026, 4, 5),   # Ostersonntag
    date(2026, 4, 6),   # Ostermontag
    date(2026, 5, 1),   # Tag der Arbeit
    date(2026, 5, 14),  # Christi Himmelfahrt
    date(2026, 5, 24),  # Pfingstsonntag
    date(2026, 5, 25),  # Pfingstmontag
    date(2026, 6, 4),   # Fronleichnam
}

# ─── HTTP helpers ─────────────────────────────────────────────────────────────
def delete(path: str) -> bool:
    try:
        r = requests.delete(f"{BASE_URL}{path}", timeout=10)
        return r.ok or r.status_code == 404
    except Exception as e:
        print(f"  ✗ DELETE {path} exception: {e}")
        return False


def get(path: str):
    try:
        r = requests.get(f"{BASE_URL}{path}", timeout=10)
        if r.ok:
            return r.json()
        return None
    except Exception as e:
        print(f"  ✗ GET {path} exception: {e}")
        return None


def post(path: str, data: dict):
    try:
        r = requests.post(f"{BASE_URL}{path}", json=data, timeout=10)
        if r.ok:
            return r.json()
        if r.status_code != 409:
            print(f"  ✗ POST {path} → {r.status_code}: {r.text[:120]}")
        return None
    except Exception as e:
        print(f"  ✗ POST {path} exception: {e}")
        return None


def _id(resp) -> str | None:
    return resp.get("id") if resp else None

# ─── Cleanup ──────────────────────────────────────────────────────────────────
print(f"\n=== Seeding to {BASE_URL} ===")
print("\n--- Clearing existing data ---")

def delete_all(list_path: str, delete_path_tpl: str, label: str) -> int:
    items = get(list_path)
    if not items:
        return 0
    if isinstance(items, dict):
        items = items.get("data") or items.get("tasks") or []
    n = 0
    for item in items:
        item_id = item.get("id")
        if item_id and delete(delete_path_tpl.format(id=item_id)):
            n += 1
    print(f"  ✓ Deleted {n} {label}")
    return n

existing_employees = get("/employees") or []
if isinstance(existing_employees, dict):
    existing_employees = existing_employees.get("data", [])
csp_deleted = 0
for emp in existing_employees:
    plans = get(f"/employees/{emp['id']}/confirmed-shift-plans") or []
    if isinstance(plans, dict):
        plans = plans.get("data", [])
    for plan in plans:
        if delete(f"/employees/{emp['id']}/confirmed-shift-plans/{plan['id']}"):
            csp_deleted += 1
print(f"  ✓ Deleted {csp_deleted} confirmed shift plans")

delete_all("/shift-assignments", "/shift-assignments/{id}", "shift assignments")
delete_all("/unavailabilities",  "/unavailabilities/{id}",  "unavailabilities")
delete_all("/shift-wishes",      "/shift-wishes/{id}",      "shift wishes")

for emp in existing_employees:
    delete(f"/employees/{emp['id']}")
print(f"  ✓ Deleted {len(existing_employees)} employees")

existing_workstations = get("/workstations") or []
for ws in existing_workstations:
    delete(f"/workstations/{ws['id']}")
print(f"  ✓ Deleted {len(existing_workstations)} workstations")

existing_shifts_all = get("/shifts") or []
for s in existing_shifts_all:
    delete(f"/shifts/{s['id']}")
print(f"  ✓ Deleted {len(existing_shifts_all)} shifts")

existing_caps_all = get("/capabilities") or []
for c in existing_caps_all:
    delete(f"/capabilities/{c['id']}")
print(f"  ✓ Deleted {len(existing_caps_all)} capabilities")

# ─── Shifts (5) ───────────────────────────────────────────────────────────────
print("\n--- Shifts ---")

SHIFT_DEFS = [
    {
        "name": "Frühschicht", "short_name": "F", "color": "#22C55E", "order": 1,
        "weekday_times": {
            0: ("06:00", "14:00", 3, 8),
            1: ("06:00", "14:00", 3, 8),
            2: ("06:00", "14:00", 3, 8),
            3: ("06:00", "14:00", 3, 8),
            4: ("06:00", "14:00", 3, 8),
            5: ("06:00", "14:00", 2, 6),
            6: ("06:00", "14:00", 2, 6),
        },
    },
    {
        "name": "Normalschicht", "short_name": "No", "color": "#3B82F6", "order": 2,
        "weekday_times": {
            0: ("08:00", "16:00", 2, 8),
            1: ("08:00", "16:00", 2, 8),
            2: ("08:00", "16:00", 2, 8),
            3: ("08:00", "16:00", 2, 8),
            4: ("08:00", "16:00", 2, 8),
        },
    },
    {
        "name": "Spätschicht", "short_name": "S", "color": "#F97316", "order": 3,
        "weekday_times": {
            0: ("14:00", "22:00", 2, 6),
            1: ("14:00", "22:00", 2, 6),
            2: ("14:00", "22:00", 2, 6),
            3: ("14:00", "22:00", 2, 6),
            4: ("14:00", "22:00", 2, 6),
            5: ("14:00", "22:00", 1, 4),
            6: ("14:00", "22:00", 1, 4),
        },
    },
    {
        "name": "Nachtschicht", "short_name": "Na", "color": "#6366F1", "order": 4,
        "weekday_times": {
            0: ("22:00", "06:00", 1, 3),
            1: ("22:00", "06:00", 1, 3),
            2: ("22:00", "06:00", 1, 3),
            3: ("22:00", "06:00", 1, 3),
            4: ("22:00", "06:00", 1, 3),
            5: ("22:00", "06:00", 1, 3),
            6: ("22:00", "06:00", 1, 3),
        },
    },
    {
        "name": "Rufdienst", "short_name": "R", "color": "#EAB308", "order": 5,
        "weekday_times": {
            5: ("00:00", "23:59", 1, 4),
            6: ("00:00", "23:59", 1, 4),
        },
    },
]

shift_ids: dict[str, str] = {}
shift_id_list: list[str] = []

for sd in SHIFT_DEFS:
    resp = post("/shifts", {
        "name": sd["name"],
        "short_name": sd["short_name"],
        "color": sd["color"],
        "order": sd["order"],
    })
    sid = _id(resp)
    if not sid:
        print(f"  ✗ Could not create shift '{sd['name']}' — skipping")
        continue
    shift_ids[sd["name"]] = sid
    shift_id_list.append(sid)
    for weekday, (start, end, mn, mx) in sd["weekday_times"].items():
        post(f"/shifts/{sid}/weekday-times", {
            "weekday": weekday,
            "start_time": start,
            "end_time": end,
            "min_employees": mn,
            "max_employees": mx,
        })
    days_str = ",".join(str(k) for k in sd["weekday_times"])
    print(f"  ✓ {sd['name']} → {sid}  (weekdays: {days_str})")

# ─── Capabilities (10) ────────────────────────────────────────────────────────
print("\n--- Capabilities ---")

CAP_NAMES = [
    "Intensivpflege",   # 0 — required by Intensivstation A
    "Notaufnahme",      # 1 — required by Notaufnahme
    "OP-Assistenz",     # 2 — required by OP-Saal 1
    "Anästhesie",       # 3 — required by OP-Saal 1
    "Beatmung",         # 4 — required by Intensivstation A
    "Wundversorgung",   # 5 — required by Notaufnahme + Station A
    "Dialyse",          # 6 — secondary
    "Endoskopie",       # 7 — required by Tagesklinik
    "Kardiologie",      # 8 — required by Station A
    "Onkologie",        # 9 — secondary
]

cap_ids: dict[str, str] = {}

for name in CAP_NAMES:
    resp = post("/capabilities", {"name": name})
    cid = _id(resp)
    if cid:
        cap_ids[name] = cid
        print(f"  ✓ {name} → {cid}")

# ─── Workstations (5) ─────────────────────────────────────────────────────────
print("\n--- Workstations ---")

def shift_set(*names: str) -> list[str]:
    return [shift_ids[n] for n in names if n in shift_ids]

all_shifts    = shift_set("Frühschicht", "Normalschicht", "Spätschicht", "Nachtschicht", "Rufdienst")
full24_shifts = shift_set("Frühschicht", "Spätschicht", "Nachtschicht", "Rufdienst")
day_shifts    = shift_set("Frühschicht", "Normalschicht", "Spätschicht")
nacht_shifts  = shift_set("Frühschicht", "Spätschicht", "Nachtschicht")

WS_DEFS = [
    {
        "name": "Notaufnahme",
        "priority": "high",
        "shifts": all_shifts,
        # employees must have BOTH of these capabilities
        "caps": ["Notaufnahme", "Wundversorgung"],
    },
    {
        "name": "Intensivstation A",
        "priority": "high",
        "shifts": full24_shifts,
        "caps": ["Intensivpflege", "Beatmung"],
    },
    {
        "name": "OP-Saal 1",
        "priority": "high",
        "shifts": day_shifts,
        "caps": ["OP-Assistenz", "Anästhesie"],
    },
    {
        "name": "Station A",
        "priority": "medium",
        "shifts": nacht_shifts,
        "caps": ["Wundversorgung", "Kardiologie"],
    },
    {
        "name": "Tagesklinik",
        "priority": "low",
        "shifts": day_shifts,
        "caps": ["Endoskopie"],
    },
]

ws_ids: list[str] = []

for wsd in WS_DEFS:
    resp = post("/workstations", {
        "name": wsd["name"],
        "available": True,
        "active_shift_ids": wsd["shifts"],
        "priority": wsd["priority"],
    })
    wid = _id(resp)
    if wid:
        ws_ids.append(wid)
        for cap_name in wsd["caps"]:
            if cap_name in cap_ids:
                post(f"/workstations/{wid}/required-capabilities", {"capability_id": cap_ids[cap_name]})
        print(f"  ✓ {wsd['name']} [{wsd['priority']}] → {wid}  (requires: {', '.join(wsd['caps'])})")

# ─── Employee Groups ───────────────────────────────────────────────────────────
# Each group is aligned to one workstation.  All employees in a group receive
# the COMPLETE set of capabilities required by their workstation so the
# optimizer can assign them there (ws_req_skills must be a SUBSET of emp_skills).
#
# Available shifts are chosen so the workstation's operating shifts are covered.
# The "extra_caps" are secondary capabilities some employees also receive to
# allow cross-workstation assignments.
EMP_GROUPS = [
    {
        "name":        "ER",
        "workstation": "Notaufnahme",
        "caps":        ["Notaufnahme", "Wundversorgung"],   # both required by Notaufnahme
        "extra_caps":  ["Kardiologie"],                      # can also work Station A (needs Wundversorgung+Kardiologie)
        "shifts":      ["Frühschicht", "Normalschicht", "Spätschicht", "Nachtschicht"],
        "count":       8,
        "monthly_h":   160.0,
        "days_pw":     5,
        "wknd":        0.30,
    },
    {
        "name":        "ICU",
        "workstation": "Intensivstation A",
        "caps":        ["Intensivpflege", "Beatmung"],       # both required by Intensivstation A
        "extra_caps":  [],
        "shifts":      ["Frühschicht", "Spätschicht", "Nachtschicht", "Rufdienst"],
        "count":       8,
        "monthly_h":   160.0,
        "days_pw":     5,
        "wknd":        0.40,
    },
    {
        "name":        "OR",
        "workstation": "OP-Saal 1",
        "caps":        ["OP-Assistenz", "Anästhesie"],       # both required by OP-Saal 1
        "extra_caps":  ["Intensivpflege"],                   # combined with Beatmung → ICU eligibility (needs all 4)
        "shifts":      ["Frühschicht", "Normalschicht", "Spätschicht"],
        "count":       8,
        "monthly_h":   160.0,
        "days_pw":     5,
        "wknd":        0.15,
    },
    {
        "name":        "Ward",
        "workstation": "Station A",
        "caps":        ["Wundversorgung", "Kardiologie"],    # both required by Station A
        "extra_caps":  ["Notaufnahme"],                      # combined with Wundversorgung → Notaufnahme eligibility
        "shifts":      ["Frühschicht", "Normalschicht", "Spätschicht", "Nachtschicht"],
        "count":       8,
        "monthly_h":   160.0,
        "days_pw":     5,
        "wknd":        0.25,
    },
    {
        "name":        "Clinic",
        "workstation": "Tagesklinik",
        "caps":        ["Endoskopie"],                       # only requirement for Tagesklinik
        "extra_caps":  ["Dialyse", "Onkologie"],
        "shifts":      ["Frühschicht", "Normalschicht", "Spätschicht"],
        "count":       8,
        "monthly_h":   120.0,
        "days_pw":     4,
        "wknd":        0.10,
    },
]

# ─── Employees (40) ───────────────────────────────────────────────────────────
print("\n--- Employees (40) ---")

FIRST_NAMES = [
    # ER group (8)
    "Anna", "Benjamin", "Clara", "Daniel", "Elena", "Felix", "Gabriela", "Hannes",
    # ICU group (8)
    "Ingrid", "Jan", "Katharina", "Lukas", "Maria", "Niklas", "Olivia", "Paul",
    # OR group (8)
    "Rosa", "Stefan", "Theresa", "Ursula", "Viktor", "Werner", "Xenia", "Yvonne",
    # Ward group (8)
    "Bernd", "Albert", "Barbara", "Christoph", "Dorothea", "Erika", "Friedrich", "Gerda",
    # Clinic group (8)
    "Herbert", "Ines", "Johann", "Karin", "Leopold", "Martina", "Norbert", "Peter",
]

LAST_NAMES = [
    # ER group (8)
    "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
    # ICU group (8)
    "Schulz", "Hoffmann", "Koch", "Bauer", "Richter", "Klein", "Wolf", "Schröder",
    # OR group (8)
    "Neumann", "Schwarz", "Braun", "Zimmermann", "Krüger", "Hartmann", "Lange", "Werner",
    # Ward group (8)
    "Krause", "Pfeiffer", "Sommer", "Unger", "Voigt", "Winkler", "Arnold", "Berger",
    # Clinic group (8)
    "Conrad", "Engel", "Frank", "Gruber", "Huber", "Jung", "Kaiser", "Lorenz",
]

def sanitize(s: str) -> str:
    for a, b in [("ü","ue"),("ö","oe"),("ä","ae"),("ß","ss"),
                 ("Ü","Ue"),("Ö","Oe"),("Ä","Ae")]:
        s = s.replace(a, b)
    return s

employees: list[dict] = []
emp_idx = 0

for grp in EMP_GROUPS:
    print(f"  → Group {grp['name']} ({grp['workstation']}, {grp['count']} employees):")
    for k in range(grp["count"]):
        first = FIRST_NAMES[emp_idx % len(FIRST_NAMES)]
        last  = LAST_NAMES[emp_idx % len(LAST_NAMES)]
        name  = f"{first} {last}"
        email = f"{sanitize(first).lower()}.{sanitize(last).lower()}{emp_idx+1}@klinik.de"

        resp = post("/employees", {
            "name": name,
            "email": email,
            "monthly_working_hours": grp["monthly_h"],
        })
        eid = _id(resp)
        if eid:
            employees.append({
                "id":              eid,
                "name":            name,
                "group":           grp["name"],
                "caps":            grp["caps"],
                "extra_caps":      grp["extra_caps"],
                "avail_shift_names": grp["shifts"],
                "monthly_hours":   grp["monthly_h"],
                "days_per_week":   grp["days_pw"],
                "weekend_chance":  grp["wknd"],
            })
            print(f"    ✓ #{emp_idx+1:02d} {name} → {eid}")
        emp_idx += 1

print(f"  ✓ {len(employees)} employees created")

# ─── Capabilities per employee ─────────────────────────────────────────────────
print("\n--- Employee capabilities ---")
total_cap_links = 0

for emp in employees:
    # Primary caps — guarantees the employee can be assigned to their workstation
    all_caps_for_emp = list(emp["caps"])
    # Extra caps for cross-training (add a subset based on employee index)
    for cap in emp["extra_caps"]:
        all_caps_for_emp.append(cap)

    for cap_name in all_caps_for_emp:
        if cap_name in cap_ids:
            resp = post(f"/employees/{emp['id']}/capabilities", {"capability_id": cap_ids[cap_name]})
            if resp is not None:
                total_cap_links += 1

print(f"  ✓ {total_cap_links} capability assignments")

# ─── Available shifts per employee ─────────────────────────────────────────────
print("\n--- Employee available shifts ---")
total_shift_links = 0

for emp in employees:
    for shift_name in emp["avail_shift_names"]:
        if shift_name in shift_ids:
            resp = post(f"/employees/{emp['id']}/available-shifts", {"shift_id": shift_ids[shift_name]})
            if resp is not None:
                total_shift_links += 1

print(f"  ✓ {total_shift_links} available-shift assignments")

# ─── Pre-compute date list ─────────────────────────────────────────────────────
ALL_DATES: list[date] = []
d = PERIOD_START
while d <= PERIOD_END:
    ALL_DATES.append(d)
    d += timedelta(days=1)

WEEKDAY_SHIFT_NAMES = {"Frühschicht", "Normalschicht", "Spätschicht", "Nachtschicht"}
WEEKEND_SHIFT_NAMES = {"Frühschicht", "Spätschicht", "Nachtschicht", "Rufdienst"}

# ─── Unavailabilities ─────────────────────────────────────────────────────────
print("\n--- Unavailabilities (future) ---")

emp_vacation_days: dict[str, set[date]] = {}
unav_created = 0

for emp in employees:
    eid = emp["id"]
    vac_days: set[date] = set()

    num_vac = random.randint(1, 2)
    for _ in range(num_vac):
        offset = random.randint(0, 80)
        vac_start = PERIOD_START + timedelta(days=offset)
        vac_len = random.randint(5, 14)
        for j in range(vac_len):
            day = vac_start + timedelta(days=j)
            if PERIOD_START <= day <= PERIOD_END:
                vac_days.add(day)

    emp_vacation_days[eid] = vac_days

    # Future vacation
    future_offset = random.randint(7, 60)
    future_start  = TODAY + timedelta(days=future_offset)
    future_len    = random.randint(5, 12)
    for j in range(future_len):
        fut_day = future_start + timedelta(days=j)
        resp = post("/unavailabilities", {
            "employee_id": eid,
            "unavailable_date": fut_day.isoformat(),
        })
        if resp:
            unav_created += 1

    # Scattered single-day future unavailabilities
    for _ in range(random.randint(1, 3)):
        extra_day = TODAY + timedelta(days=random.randint(1, 90))
        resp = post("/unavailabilities", {
            "employee_id": eid,
            "unavailable_date": extra_day.isoformat(),
        })
        if resp:
            unav_created += 1

print(f"  ✓ {unav_created} future unavailability entries")

# ─── Shift wishes (future) ────────────────────────────────────────────────────
# Each employee wishes to work a few specific shifts on future dates. The
# optimizer treats these as a soft reward (wish_weight); the employee calendar
# shows them with a dashed "wish" chip.
print("\n--- Shift wishes (future) ---")

wishes_created = 0

for emp in employees:
    eid = emp["id"]
    wish_shift_ids = [shift_ids[n] for n in emp["avail_shift_names"] if n in shift_ids]
    if not wish_shift_ids:
        continue

    wish_dates = random.sample(range(1, 45), random.randint(2, 5))
    for offset in wish_dates:
        wish_day = TODAY + timedelta(days=offset)
        resp = post("/shift-wishes", {
            "employee_id": eid,
            "shift_id": random.choice(wish_shift_ids),
            "wish_date": wish_day.isoformat(),
        })
        if resp:
            wishes_created += 1

print(f"  ✓ {wishes_created} shift wishes")

# ─── Confirmed Shift Plans — past 3 months ────────────────────────────────────
print("\n--- Confirmed shift plans (past 3 months) ---")

csp_created = 0

def iso_week(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return (iso[0], iso[1])

date_by_week: dict[tuple, list[date]] = {}
for dt in ALL_DATES:
    key = iso_week(dt)
    date_by_week.setdefault(key, []).append(dt)

for emp in employees:
    eid           = emp["id"]
    days_per_week = emp["days_per_week"]
    wknd_chance   = emp["weekend_chance"]
    vac_days      = emp_vacation_days[eid]
    avail_names   = emp["avail_shift_names"]

    wd_shift_ids = [shift_ids[n] for n in avail_names if n in shift_ids and n in WEEKDAY_SHIFT_NAMES]
    we_shift_ids = [shift_ids[n] for n in avail_names if n in shift_ids and n in WEEKEND_SHIFT_NAMES]
    if not wd_shift_ids:
        wd_shift_ids = [shift_id_list[0]]
    if not we_shift_ids:
        we_shift_ids = [shift_id_list[0]]

    group_ws_index = next(
        (i for i, g in enumerate(EMP_GROUPS) if g["name"] == emp["group"]), 0
    )
    ws_id = ws_ids[group_ws_index] if group_ws_index < len(ws_ids) else (ws_ids[0] if ws_ids else None)

    used_dates: set[date] = set()

    for week_key, week_dates in date_by_week.items():
        weekdays = [dt for dt in week_dates if dt.weekday() < 5]
        weekends = [dt for dt in week_dates if dt.weekday() >= 5]

        n_wd = min(days_per_week, len(weekdays))
        chosen_weekdays = random.sample(weekdays, n_wd)
        chosen_weekends = [dt for dt in weekends if random.random() < wknd_chance]

        for dt in chosen_weekdays + chosen_weekends:
            if dt in used_dates:
                continue

            is_weekend  = dt.weekday() >= 5
            is_holiday  = dt in HOLIDAYS
            is_vacation = dt in vac_days

            shift_id = random.choice(we_shift_ids if is_weekend else wd_shift_ids)

            if is_vacation:
                resp = post(f"/employees/{eid}/confirmed-shift-plans", {
                    "shift_id": shift_id, "workstation_id": ws_id,
                    "date": dt.isoformat(), "is_present": False,
                    "absence_type": "day_off", "creation_type": "manual",
                })
            elif is_holiday:
                if random.random() < 0.85:
                    resp = post(f"/employees/{eid}/confirmed-shift-plans", {
                        "shift_id": shift_id, "workstation_id": ws_id,
                        "date": dt.isoformat(), "is_present": False,
                        "absence_type": "holiday", "creation_type": "manual",
                    })
                else:
                    resp = post(f"/employees/{eid}/confirmed-shift-plans", {
                        "shift_id": shift_id, "workstation_id": ws_id,
                        "date": dt.isoformat(), "is_present": True,
                        "creation_type": "automated",
                    })
            elif random.random() < 0.07:
                resp = post(f"/employees/{eid}/confirmed-shift-plans", {
                    "shift_id": shift_id, "workstation_id": ws_id,
                    "date": dt.isoformat(), "is_present": False,
                    "absence_type": "sick", "creation_type": "manual",
                })
            else:
                resp = post(f"/employees/{eid}/confirmed-shift-plans", {
                    "shift_id": shift_id, "workstation_id": ws_id,
                    "date": dt.isoformat(), "is_present": True,
                    "creation_type": "automated",
                })

            if resp:
                csp_created += 1
                used_dates.add(dt)

# ─── Summary ──────────────────────────────────────────────────────────────────
print(f"\n=== Seeding complete ===")
print(f"  Shifts:                {len(shift_ids)}")
print(f"  Capabilities:          {len(cap_ids)}")
print(f"  Employees:             {len(employees)} (8 per workstation group)")
print(f"  Workstations:          {len(ws_ids)}")
print(f"  Capability links:      {total_cap_links}")
print(f"  Available-shift links: {total_shift_links}")
print(f"  Unavailabilities:      {unav_created}  (future only)")
print(f"  Shift wishes:          {wishes_created}  (future only)")
print(f"  Confirmed shift plans: {csp_created}   ({PERIOD_START} → {PERIOD_END})")
print()
print("  Employee groups:")
for grp in EMP_GROUPS:
    print(f"    {grp['name']:8s} ({grp['workstation']:20s}): "
          f"caps={grp['caps']}  "
          f"shifts={grp['shifts']}")
