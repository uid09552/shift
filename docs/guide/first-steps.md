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
content in the middle](../assets/screenshots/dashboard.png)

**Left — the menu.** Three groups you can fold open and shut:

| Group | What lives there |
|---|---|
| **Dashboard** | *Overview* — the summary screen you land on |
| **Configuration** | User Profiles, Shifts, Workstations, Capabilities, Planner Settings, Wish Window (admins only) |
| **Planner** | Schedule, Day View, Employee Calendar, Schedule Optimizer |

Roughly: **Configuration** is where you describe the world, **Planner** is
where you work with it.

**Top — the header.** A search box, a moon/sun button that switches between the
light and dark colour scheme, a bell for notifications, and your own name.
Click your name to sign out.

**Bottom right — the assistant.** The round speech-bubble button opens a chat
window where you can ask for things in ordinary sentences. See
[The built-in assistant](assistant.md).

## The dashboard, explained

The Overview page answers "how do things stand right now?" at a glance.

| Panel | What it tells you |
|---|---|
| **Employees / Shifts / Workstations** | How many of each are on file. Click a card to jump to that list. |
| **Planned Hours per Day** | A bar per day of the current month, showing total planned working hours. Gaps mean nobody is scheduled — usually because you haven't planned that far ahead yet. |
| **Today's Coverage** | How many people are working today, how many are on leave or sick, and per workstation how many are assigned against how many are required. |
| **Latest Optimization Run** | Whether the last roster calculation finished, and when. |
| **Recent Activity** | The last few changes anyone made, so you can see if a colleague has been editing. |

The **Planned Hours per Day** chart is the quickest health check you have. A
month that ends in a run of empty bars is a month nobody has planned yet.

## Finding your way around

Two habits save a lot of clicking:

- The **breadcrumb** in the top right of each page (`Home › Workstations`)
  always tells you where you are.
- The **assistant** will take you to a page if you ask it to — *"open the
  planner settings"* works.

## What to do next

If your ward has not been set up yet, go to
[Setting up your ward](setup.md). If it already has staff and shifts on file,
skip ahead to [Creating a schedule](creating-a-plan.md).
