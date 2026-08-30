# connect-verdict-1034: what an agent may see about this computer's connections

Card #1034 part (2), SEEING. Angel, 2026-08-29.

## What finished looks like

An agent on this computer can ask what is connected and get a useful, honest answer,
**and cannot learn anything it could use as a credential.** Concretely: `kosmos
connections` prints a verdict per provider and per service, and the JSON behind it
contains no sign-in URL, no terminal output, no account email, no filesystem path.

## The decision this is built under

The card called part (2) *"a privacy decision, not a default"*. Splinter ruled
**verdict only**; Josh is told as a one-liner he can overrule, not as a blocker. The
reason it did not need to wait: **the two directions are not symmetric. Verdict-only
widens in a commit; a leaked sign-in URL cannot be un-leaked.** A live OAuth URL is a
bearer credential for its window, so the safe default is do not expose.

## Why a boundary module rather than a filter at the route

The obvious implementation is to hand an agent `connect.state()`, which already exists
and is four lines away. Measured, it returns `url` (a live OAuth authorize URL,
reassembled across wrapped lines) and `tail` (12 lines of raw terminal output from the
pane where the person pastes their code). `redact|scrub|mask|sanitiz` across
`connect.js` = **0**, control `tail` = **20**: there is no redaction layer to inherit.

So the safe shape is not a filter applied at one route, which the next route forgets.
It is **one module that constructs the safe view**, with the rich inputs going in and
nothing but verdicts coming out.

## The rule, chosen so it is provable rather than reviewed

**Nothing is passed through. Every string in the output is either an enum value this
module allowlists, or a sentence from this module's own table.**

One rule rather than two, and it is checkable by a test that can actually fail: plant a
foreign string anywhere in the input, assert it does not appear in the serialized
output, with a control asserting the planted string IS in the input.

⚠️ **The measurement that forced this.** A pass-through of `because` looks safe: 0 of
the 23 in `connect.js` interpolate captured output. But `subscription.js:213` builds
`` `...we do not recognise the plan of (${org})` `` from the person's Claude config.
**One free-text field, two source modules, opposite answers.** A rule of "pass through
the safe ones" would have been true when written and wrong on the next edit.

## Three states, not two, and it is this codebase's convention

`subscription.STATE` is already `{ CONNECTED, NONE, UNKNOWN }` and is reused rather
than re-invented. `install/kosmos`'s `cmd_agents` already refuses a confident "None"
when it is merely blind, because *"a confident None ends the search at exactly the
moment a person is trying to find their agents."* A connection verdict inherits that:
**cannot tell** is a real answer and is never collapsed into **not connected**.

## Scope

**In:** the boundary module, one read route, one CLI verb, tests.

**Out, deliberately:**
- Part (1) KNOWING. Merged as PR #1060; this card already records one duplicate-build
  near-miss on it.
- Part (3) DOING. Different risk, and the card says not to smuggle it in.
- Narrowing the existing `/api/connect`, which the board's own screen consumes. Its
  audience is the operator on their own machine, which is a different question.
- `GET /api/connections` (service doors) is **already** verdict-only and three-state,
  so it is composed, not rebuilt.
- The GPT wording gap, which is content and owned elsewhere. Still open: `GPT` 0 in
  `engine/connections.js`, control `provider` 9.

## 🛑 THIS IS NOT A PRIVILEGE BOUNDARY, AND NOTHING HERE MAY IMPLY IT IS

Found by me and independently by review, which is why it is stated at this length.

**The board binds `127.0.0.1` with no auth**, and an agent is a program running as this
user. It can already:

- `curl` the ungated `/api/accounts`, which returns **account emails**
- `curl` the ungated `/api/connect`, which returns the **live OAuth URL and terminal tail**
- read the config directories directly, with no HTTP at all

⇒ **`/api/agent/connections` is a safe OPTION an agent can choose, not a constraint on
it.** Any sentence of the form "an agent cannot learn a sign-in URL" is false at the
machine level and must be scoped to this route.

### What it actually buys, stated precisely

**It keeps a bearer credential out of the agent's context window by default.**

A sign-in URL that lands in an agent's context does not stay there: it propagates into
channel messages, commit bodies, handoff files, logs and other agents' transcripts. On
this fleet that is the normal flow of a working day, not a hypothetical. **The exposure
this addresses is propagation, not access.** An agent asking the ordinary question gets
an answer that cannot leak; an agent that goes looking was always able to find it.

⚠️ **None of this is a regression. The exposure predates the branch**, and narrowing
`/api/connect` is a different change with a different blast radius: the board's own
screen consumes it.

## Weakest premise, named by me

**The allowlist is only as good as its list.** If a future field is added to a source
module and someone extends the agent view to carry it, the test I am writing catches a
planted foreign *value* but cannot know that a newly-added *field name* is sensitive.
That is a real residual, mitigated by the output shape being constructed explicitly
rather than spread from the input.
