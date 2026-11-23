# command-palette Specification

## Purpose
Get anywhere and start common work from the keyboard, on every page.

## Requirements

### Requirement: Open from every page
Ctrl+K (⌘K on Apple devices) and a header button SHALL open the palette on every page. Escape SHALL close it and return focus to where it was.

### Requirement: What it finds
The palette SHALL find people (their calendar), workstations, shifts and capabilities (their edit page for planners), and every page the user's role may open. A typed date — ISO, `24.12.`, `tomorrow`, a weekday, `next Monday`, in English or German — SHALL offer the Schedule page on that day.

#### Scenario: Date
- **WHEN** the user types `2026-12-24` and presses Enter
- **THEN** the Schedule page opens on 24 December 2026

### Requirement: Quick actions by role
Planners SHALL be offered: calculate a plan, publish this or next month, find a replacement for a named person today, add an employee, shift or workstation. Viewers SHALL be offered: request leave, my calendar. Nothing a role cannot open SHALL be offered.

#### Scenario: Viewer
- **WHEN** a viewer searches for "calculate"
- **THEN** no planning action is listed

### Requirement: Keyboard only
Arrow keys SHALL move the selection, Enter SHALL open it, and Tab SHALL stay inside the palette. The input SHALL be a combobox naming the selected option.
