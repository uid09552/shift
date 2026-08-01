# The built-in assistant

The round speech-bubble button in the bottom-right corner of every page opens
a chat window. You can ask for things in ordinary sentences instead of hunting
through menus.

![Asking the assistant a question — it has answered and taken us to the
Planner Settings page](../assets/screenshots/assistant.png)

## What it can do

The assistant can use the same functions the screens use, and it can read this
documentation. In practice that means four sorts of request:

**Take me somewhere.**

> *"Open the planner settings."*
> *"Show me the workstation calendar."*

The page changes underneath the chat window, as in the screenshot above.

**Tell me something.**

> *"How many employees do we have?"*
> *"Which capabilities does Anna Müller hold?"*
> *"What is the night shift recovery set to?"*
> *"Is there a plan for next week?"*

**Change something.**

> *"Set the minimum rest to 12 hours."*
> *"Add a capability called Dialysis."*
> *"Mark Thomas Weber unavailable on the 14th of March."*

**Explain something.**

> *"How do I confirm a plan?"*
> *"What does 'soft minimum' actually mean?"*
> *"Why would the planner call a week infeasible?"*
> *"What is the difference between a shift wish and an available shift?"*

Answers of this last sort come out of the product's own documentation rather
than the model's general knowledge, so they describe *this* system — and they
are only as current as the documentation is.

## How to get good answers

- **Say what you want, not how.** "Who is working in the emergency room on
  Friday?" works better than trying to describe menus.
- **Be specific about names and dates.** Full names and actual dates —
  "14 March" rather than "next Tuesday" — leave less room for it to guess
  wrong.
- **One thing at a time.** A request bundling four changes is more likely to
  go half-right than four separate requests.
- **It remembers the conversation.** You can follow up with "and the one
  after that" without repeating yourself.

## What to be careful about

!!! warning "Check changes it makes"
    The assistant can genuinely change your data — settings, staff records,
    absences. It is usually right, but it is not infallible, and there is no
    undo button. After asking it to change something, look at the affected
    screen and confirm it did what you meant.

A few honest limits:

- **It cannot do anything you cannot do.** It acts as *you*, with your
  permissions, in your organisation. It cannot see another ward's data.
- **It cannot calculate a roster faster than the planner can.** Asking it to
  plan still runs the same calculation, which still takes as long as it takes.
- **It only knows what is in the system.** It has no access to your email,
  your paper notes or last month's WhatsApp messages.

## When it isn't there

If the button is missing or the chat replies with an error about being
unavailable, the assistant service isn't running. That is an installation
matter — everything else in the app works perfectly well without it. Speak to
whoever administers the system.

---

!!! info "For the technically minded"
    The assistant is a language model driving the same REST API the screens
    use, exposed as tools through an MCP server generated from the API
    specification. Architecture, provider options and configuration are in
    [Agent & MCP](../agent.md).
