---
type: Task Guide
title: Using the Built-In Assistant
description: What the chat assistant can do, how to phrase requests so it gets them right, and its honest limits.
tags: [user-guide, assistant, chat, llm]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-08-01T00:00:00Z
sources:
  - resource: docs/guide/assistant.md
    author: human:maxrg
    last_modified: 2026-08-01
---

The round speech-bubble button in the bottom-right corner of every page opens a
chat window. Ask for things in ordinary sentences instead of hunting through
menus.

# What it can do

The assistant uses the same functions the screens use, and it can read this
documentation, so requests fall into six sorts:

**Take me somewhere.**
> *"Open the planner settings."* · *"Show me the workstation calendar."*

The page changes underneath the chat window.

**Tell me something.**
> *"How many employees do we have?"* · *"Which capabilities does Anna Müller hold?"* · *"What is the night shift recovery set to?"* · *"Is there a plan for next week?"*

**Change something.**
> *"Set the minimum rest to 12 hours."* · *"Add a capability called Dialysis."* · *"Mark Thomas Weber unavailable on the 14th of March."*

**Read a file for me.**
> Attach an existing shift plan with the paperclip button — a spreadsheet, a CSV,
> or a PDF printed from one. The assistant works out which columns hold the
> people, the dates and the shifts, shows you what it read, and asks before
> taking it as shift assignments. See [Importing a
> roster](/guide/importing-a-roster.md).

**Check a plan for me.**
> *"Is the latest plan OK?"* · *"Does anything in that plan break a rule?"*

It re-checks a proposed plan against every rule the planner was solving under and
reports what it finds — the same check the **Verify Plan** button on the Schedule
Optimizer runs, and the same numbers, because both call the same code. See
[Creating a schedule](/guide/creating-a-schedule.md).

**Explain something.**
> *"How do I confirm a plan?"* · *"What does 'soft minimum' actually mean?"* · *"Why would the planner call a week infeasible?"* · *"What is the difference between a shift wish and an available shift?"*

Answers to these come out of the product's written documentation — the same pages
this one lives among — not out of the model's general knowledge. Ask it where an
answer came from and it can name the page.

# How to get good answers

* **Say what you want, not how.** "Who is working in the emergency room on
  Friday?" beats trying to describe menus.
* **Be specific about names and dates.** Full names and actual dates — "14 March"
  rather than "next Tuesday" — leave less room to guess wrong.
* **One thing at a time.** A request bundling four changes is likelier to go
  half-right than four separate requests.
* **It remembers the conversation.** You can follow up with "and the one after
  that" without repeating yourself.

# What to be careful about

**Check changes it makes.** The assistant can genuinely change your data —
settings, staff records, absences. It is usually right, it is not infallible, and
there is no undo button. After asking it to change something, look at the affected
screen.

Honest limits:

* **It cannot do anything you cannot do.** It acts as *you*, with your
  permissions, in your organisation. It cannot see another ward's data. Technically
  it carries your own token the whole way — see
  [Gateway and identity](/architecture/gateway-and-identity.md).
* **It cannot calculate a roster faster than the planner can.** Asking it to plan
  runs the same calculation, which takes as long as it takes.
* **Its plan check counts, it does not judge.** It reports the rules a plan
  breaks; whether a thin Sunday is acceptable on your ward is still your call.
* **It only knows what is in the system.** No access to your email, your paper
  notes or last month's messages.
* **Its explanations are only as current as the documentation.** If a page here
  is out of date, so is the answer — it quotes the documentation rather than
  inspecting the running code.

# When it isn't there

If the button is missing, or the chat replies with an error about being
unavailable, the assistant service isn't running. That is an installation matter —
everything else in the app works perfectly well without it.

# Related

* Handing it a file: [Importing a roster](/guide/importing-a-roster.md)
* How it works: [Agent and MCP service](/architecture/agent-and-mcp-service.md)
* What it can call: [MCP tool surface](/interfaces/mcp-tool-surface.md)
