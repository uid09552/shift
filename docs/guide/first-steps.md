# First steps

## Signing in

Open the address your administrator gave you — typically something like
`https://planner.your-hospital.example/`. You will be sent to a login page
before you see anything else.

1. Type your **username or email address** and press **Sign In**.
2. If you work for more than one organisation, you are asked to **choose an
   organisation**. Pick the one whose roster you want to work on.
3. Type your **password** and press **Sign In** again.

!!! note "Why the organisation question?"
    The system can hold several wards or hospitals side by side, completely
    separated from each other. Whichever organisation you pick, you see only
    that organisation's staff, shifts and plans. Picking the wrong one is not
    dangerous — sign out and back in to switch.

!!! warning "Being signed out again"
    Sessions expire after a while for security reasons. If lists suddenly
    appear empty or your name disappears from the top right corner, reload the
    page — you will be asked to sign in again. Nothing is lost.

Passwords, accounts and who is allowed to do what are all managed outside this
app. If you cannot get in, or you can get in but a page refuses to save,
contact whoever administers your login.

## The screen

Every page shares the same frame.

![The dashboard with the menu on the left, the header along the top and the
content in the middle, here showing one nurse's day](../assets/screenshots/dashboard.png)

**Left — the menu.** Three groups you can fold open and shut:

| Group | What lives there |
|---|---|
| **Dashboard** | *Overview* — the summary screen you land on |
| **Configuration** | User Profiles, Shifts, Workstations, Capabilities, Planner Settings, Wish Window (admins only), Users (admins only), Audit log |
| **Planner** | Schedule (day, week, month), Employee Calendar, Rotations, Schedule Optimizer, Fairness |
| **Reports** | Ontology — who can work where; Analytics — staffing, hours, absences, changes, audit and planning runs over time (planners and admins) |

Roughly: **Configuration** is where you describe the world, **Planner** is
where you work with it.

The small box under the menu shows the **version** you are running. Quote it
when you report a problem.

Two entries appear only if you are an administrator — **Wish Window** and
**Users**. If you cannot see them, you are not one; see [Users, roles and
history](administration.md).

**Top — the header.** A search box, a language button (**EN** / **DE**), a
moon/sun button that switches between the light and dark colour scheme, a bell
for notifications, and your own name. Click your name to sign out.

The language setting is yours alone — it changes what *you* see, immediately
and on every page, and it does not affect your colleagues or anything stored in
the system. Names you typed in yourself, such as a shift called *Frühdienst*,
stay exactly as you typed them.

**Bottom right — the assistant.** The round speech-bubble button opens a chat
window where you can ask for things in ordinary sentences. See
[The built-in assistant](assistant.md).

## The dashboard, explained

The Overview page answers "what needs me, and how do things stand?" at a glance.
What it shows depends on your role.

### As a planner or admin

| Panel | What it tells you |
|---|---|
| **Needs you** | Everything waiting for a planner, each line a link to where it is dealt with: shift swaps to approve, roster changes the people concerned have not seen yet, months that are due (or overdue) for publishing, and the last automatic plan if it stayed a proposal or failed — with the reason. When nothing is open it says *Nothing is waiting for you*. |
| **Coverage, next 7 days** | One row per shift, one column per day, each cell *staffed / minimum*. A red cell with a warning sign is short: the shift itself, or a workstation running it, is below its minimum (hover or focus it to see which). Click a short cell or a day to open that day in the Schedule. Closed workstations do not count. |
| **My day** | Your own confirmed shift today: times, workstation, and who else is on that workstation and on which shift. The strip of days underneath steps back and forward; **Open the full schedule →** jumps to the Schedule. The people button in the corner shows anyone else's day instead. If your login is not linked to an employee record (same e-mail address), it says so and offers the staff list. |
| **Latest Optimization Run** | Whether the last roster calculation finished, and when. |
| **Recent Activity** | The last few changes anyone made, so you can see if a colleague has been editing. |

The coverage grid counts staffing exactly as **Verify Plan** and the Analytics
report do, so the three never disagree about a shortfall.

### As a viewer

| Panel | What it tells you |
|---|---|
| **My day** | As above. |
| **Changes to my shifts** | Changes to your published shifts you have not seen yet — the day, what it was and what it is now. **Seen** marks one as read, and the bell's count drops. |
| **My shift swaps** | Your open swap requests. The ones waiting for your answer come first; a click opens the requests on the Schedule. Hidden while you have none. |
| **Shift wishes** | Shown while wishes can be placed: for any day, or for which days, and when the window closes if that is planned. **Enter wishes** opens the Employee Calendar. |

## Finding your way around

Two habits save a lot of clicking:

- The **breadcrumb** in the top right of each page (`Home › Workstations`)
  always tells you where you are.
- The **assistant** will take you to a page if you ask it to — *"open the
  planner settings"* works.

## What to do next

If your ward has not been set up yet, go to
[Setting up your ward](setup.md). If it already has staff and shifts on file,
skip ahead to [Creating a schedule](creating-a-plan.md). If your job is to give
your colleagues their logins, go to [Users, roles and
history](administration.md).
