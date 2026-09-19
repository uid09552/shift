# Users, roles and history

Everything so far has been about the ward. This page is about the *people who
use the software*: who gets a login, what each of them is allowed to do, and
how to find out who changed something.

Both screens are under **Configuration**, and the first of them is visible only
if you are an administrator.

---

## Who may do what

Everyone who signs in holds one or more **roles**. A role is not a job title —
it is simply the answer to "what may this person press?"

| Role | Who it is for | What they can do |
|---|---|---|
| **Viewer** | Nurses, carers, anyone on the ward | Read the schedule and their own calendar, and enter their own shift wishes. Nothing else can be changed. |
| **Planner** | Ward managers, staffing coordinators | Everything in this guide: staff, shifts, workstations, absences, calculating and confirming rosters. |
| **Admin** | Whoever runs the system for the ward | Everything a planner may do, plus this page: adding and removing users, and setting the [wish window](people.md#when-staff-may-wish-the-wish-window). |

Roles add up rather than replacing each other, and someone may hold more than
one. In practice most wards need very few admins — two is a sensible number, so
that neither of them is a single point of failure.

!!! note "What a viewer really cannot do"
    The restriction is enforced by the server, not just hidden in the menu.
    A viewer who finds their way to a page they should not have cannot save
    anything from it; the one exception is their *own* shift wishes, and even
    those are checked against their own name before being accepted.

---

## Adding someone

Open **Configuration → Users**. It lists everyone who belongs to your
organisation, with a tickbox per role.

![The Users page: each member with their roles as
tickboxes](../assets/screenshots/users.png)

Press **Add User**.

| Field | What to put in it |
|---|---|
| **Username** | What they type to sign in. It cannot be changed afterwards, so pick your house convention (`jane.smith`, a staff number) and stick to it. |
| **E-mail** | Their work address. This is also how the system links the login to the person's [employee record](people.md) — use the same address on both, or their own calendar will come up empty. |
| **First name / Last name** | How they appear in lists. |
| **Initial password** | Optional. Leave it blank and the account exists but cannot sign in until someone sets a password. |
| **Must be changed at first login** | Leave ticked when you type a password yourself, so the person chooses their own on the way in. |
| **Roles** | Tick what they may do. New accounts start as **Viewer**, which is the right answer for most of the ward. |

!!! tip "Someone who already has an account"
    Type the username of a colleague who already works for another ward on the
    same system and they are **added to your organisation**, not created a
    second time. They keep their existing password and see both wards after
    signing in.

### After adding someone

Two things are worth doing straight away:

1. Check that an **employee record** exists with the same e-mail address
   ([Managing your staff](people.md)). The login and the person on the roster
   are two different things, joined by that address.
2. Tell them their username and the initial password. The system does not send
   any mail.

---

## Changing what someone may do

The **Members** table lists everyone in the organisation, with a tickbox per
role. Tick or untick and it saves immediately — there is no separate save
button, and a short confirmation appears at the top of the page.

A row with **no role at all** is flagged in red. Such an account can sign in
but will find every page empty, which is almost never what anyone intended.
Either give it a role or remove it.

!!! warning "You cannot demote yourself"
    Unticking your own **Admin** box is refused. If it were allowed, the last
    administrator on a ward could lock everybody out of this page — and out of
    the wish window with it. Ask another admin to do it for you.

Accounts that have been switched off elsewhere (in the identity provider) show
a grey **Disabled** tag. They keep their roles but cannot sign in.

---

## When someone leaves

Press **Remove** on their row and confirm.

This takes the person **out of your organisation**: they immediately lose
access to your ward's schedules and their roles here are withdrawn. The account
itself is *not* deleted — if they work for another ward on the same system,
they carry on there untouched.

Removing yourself is refused, for the same reason as demoting yourself.

!!! note "Removing a login is not removing an employee"
    Their employee record, their capabilities and every roster they appear in
    are untouched by this. Someone who has left the ward for good should also
    be handled on the [staff list](people.md#keeping-the-list-tidy) — but not
    until the plans that mention them no longer matter.

---

## The audit log

**Configuration → Audit log** answers the question that comes up sooner or
later: *"who changed this, and what did it look like before?"*

Every change to staff, shifts, workstations, capabilities, settings and plans
is recorded — newest first. Unlike the Users page, everyone may read it.

### Narrowing it down

Along the top:

| Filter | What it does |
|---|---|
| **All time / Today / 7 days / 30 days / Custom** | The period. *Custom* reveals a from and a to date. |
| **Action** | One kind of change — *Employee changed*, *Workstation deleted*, *Plan confirmed*… |
| **Item type** | One kind of thing — only employees, only shifts. |
| **Who** | Any part of a name or e-mail address. Suggestions appear as you type. |

**Clear filters** puts everything back. The list pages with **Newer** and
**Older**, and the count on the left tells you where you are in the whole.

### Reading an entry

Click any row to open it.

![An audit entry opened: which planner settings changed, before and
after](../assets/screenshots/audit-log.png)

- **A change** shows a three-column table — *Field*, *Before*, *After* — with
  one row per thing that actually differs, and a line saying which earlier
  version it is being compared against. A save that altered nothing says so
  rather than showing an empty table.
- **A creation** shows the values the item started with.
- **A deletion** names what was deleted, and shows its last recorded state
  underneath.

At the bottom of an open entry, **All changes to this item →** filters the
whole list down to that one thing, so you can read its history from creation to
now. A chip at the top shows the filter is on; the **×** on it takes you back.

!!! tip "The fastest way to answer 'what happened to this roster?'"
    Filter by **Who** rather than by action. Most puzzles turn out to be one
    colleague working through several screens in the same ten minutes, and the
    time column makes that obvious at a glance.

---

## Next

Role and account questions usually arrive alongside the everyday ones. For
those, see [When something looks wrong](troubleshooting.md).
