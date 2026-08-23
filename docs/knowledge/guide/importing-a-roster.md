---
type: Task Guide
title: Importing an Existing Roster from a File
description: Attaching a shift plan you already have — PDF, CSV or Excel — to the assistant, checking what it read, and taking it as shift assignments.
tags: [user-guide, assistant, import, shift-assignments, excel, pdf]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-08-23T00:00:00Z
sources:
  - resource: agent/shift_agent/agent/roster.py
    author: human:maxrg
    last_modified: 2026-08-23
---

Most wards already keep a plan somewhere — a spreadsheet, or a PDF printed from
one. Rather than retyping it, attach it to the assistant with the paperclip
button in the chat window. It reads the file, tells you what it made of it, and
waits for you to agree before anything is saved.

Accepted: **.xlsx**, **.csv**, **.pdf**. Up to 10 MB.

# What happens, in order

1. **You attach the file.** Type anything useful alongside it — "this is April"
   is worth saying if the file itself never names the month.
2. **The assistant reads the layout.** Which column holds the names, where the
   dates are, which codes are shifts and which mean a day off.
3. **It tells you what it found** — the date range, how many people and how many
   assignments, which code it took for which shift, and anything it could not
   place.
4. **You say yes or no.** Nothing has been written yet. If a column was read
   wrongly, say so and it tries again.
5. **On yes, the assignments are created** as [shift
   assignments](/concepts/shift-assignment.md) — fixed commitments the planner
   works around.

# What a readable file looks like

The usual monthly grid works well: one row per person, one column per day, a
short code in each cell.

| Mitarbeiter | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Meier, Anna | F | S | N | – | – |
| Bauer, Tom | S | S | – | F | N |

So does a plain list — one row per assignment, with columns for the person, the
date and the shift.

Things that help:

* **Name the month and year somewhere**, in a title cell or in the chat. Bare day
  numbers alone do not say which month they belong to, and the assistant will ask
  rather than guess.
* **Spell names as they are in the system.** Full names match, and so do
  surname-first spellings like "Meier, Anna" and email addresses. A nickname does
  not.
* **Use the shift short codes** from your [shift](/concepts/shift.md) setup, or
  the full names. Anything else is reported as unmatched rather than guessed at.
* **Excel beats PDF.** A PDF has no cells, only text at positions; the assistant
  reconstructs the columns and usually gets it right, but a scanned PDF is an
  image and cannot be read at all. If you have the spreadsheet, send that.

# Checking what it read

The summary is the whole point of the step — read it before you agree:

* **Date range.** If it says January and you meant June, the month was misread.
* **The number of people and assignments.** A plan for 20 people that comes back
  as 3 means the name column was misidentified.
* **Unmatched names.** Someone the system has never heard of, or spelled
  differently here. Add them under [staff
  management](/guide/staff-management.md) first, or correct the file.
* **Unmatched codes.** Usually a day-off marker the assistant took for a shift,
  or a shift you have not configured. Tell it which codes mean "not working".

# Days off and absences

Codes meaning a free day, holiday or sickness are excluded from the import — the
assistant asks about or infers them, and you can correct it ("X and U mean days
off"). They are *not* recorded as absences. Enter genuine holiday and sickness as
[unavailability](/concepts/unavailability.md), which is what the planner reads.

# Existing assignments on the same days

A person can hold only one shift assignment per date. Where the file collides
with something already recorded, those rows are skipped and reported rather than
silently overwritten. If the file is the newer truth, say so and the assistant
re-runs replacing them.

# What this does not do

* **It does not confirm a plan.** These are inputs to planning, not a finished
  roster — see [Confirmed shift plan](/concepts/confirmed-shift-plan.md) for the
  difference.
* **It does not create people.** Unmatched names stay unmatched.
* **It does not read a scan.** A photographed or scanned PDF has no text in it.

# Related

* What gets created: [Shift assignment](/concepts/shift-assignment.md)
* The other way to bulk load: [XLSX import and export](/interfaces/xlsx-import-export.md)
* The assistant generally: [Using the assistant](/guide/using-the-assistant.md)
