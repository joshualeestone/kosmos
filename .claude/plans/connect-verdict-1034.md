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

## The one asymmetry this plan owes a reader

**The boundary refuses to hand an agent a filesystem path. The instruction block writes
one into every agent's file.** Both are deliberate and they are not in conflict, but the
plan named neither, and a reader who finds them separately will think one is a bug.

- `connectionverdict` lists `dir` and `bin` among the unsafe inputs, and both leak proofs
  assert `/Users/` never appears in the agent view.
- `blockBody()` embeds `kosmosCliShown()`, an absolute path under the person's home, into
  the instructions eighteen agents boot from.

⇒ **The rule is not "paths are secret". It is that a path is not a CREDENTIAL, while a
sign-in URL is.** The boundary's job is refusing bearer material and refusing to leak the
machine's shape through a ROUTE an agent can poll. The block's job is telling an agent a
command it can actually run, and the branch already measured what happens without the
path: bare `kosmos` fails on a stock install, which is the defect the path exists to fix.

⚠️ **What the trade actually costs, stated so nobody has to rediscover it:** the block's
path propagates into messages, commits and handoffs, which is exactly the surface this
plan says the card is about. That is accepted because the alternative is an instruction
that does not work, and because a home directory name is not a credential. **If that ever
stops being true for a machine, the fix is `clipath`, not the boundary.**

## Scope

**In:** the boundary module, one read route, one CLI verb, tests, **and the agent-facing
instruction copy in `engine/connections.js`**.

🛑 **That last one was missing from this list and is the widest-blast-radius edit on the
branch.** `connections.blockBody()` is spliced into every agent's `CLAUDE.md` by
`syncEveryone`, so it changes a file eighteen agents boot from. It belongs here because a
scope list that omits the only delivery-affecting change is the kind of omission this plan
spends its length arguing against.

⚠️ **And its delivery is uneven, which the plan should say rather than the code alone:** a
NEW or IMPORTED agent gets the paragraph immediately (`create.js`, `discover.js`); an agent
ALREADY RUNNING gets it only when somebody next saves the About-you form, and nothing
signals the difference.

**Out, deliberately:**
- Part (1) KNOWING. Merged as PR #1060; this card already records one duplicate-build
  near-miss on it.
- Part (3) DOING. Different risk, and the card says not to smuggle it in.
- Narrowing the existing `/api/connect`, which the board's own screen consumes. Its
  audience is the operator on their own machine, which is a different question.
- `GET /api/connections` (service doors) is **already** verdict-only and three-state.
  ⚠️ **Corrected: the SHAPE is reused, the SWEEP is not.** The route re-implements the
  door sweep inline, including the `github` -> `githubdevice` fallback, so "composed"
  overstated it. **Corrected again, iteration 9:** this used to say token doors are
  enumerated from `tokendoors.routes()` and stay in step. They are no longer enumerated
  in the agent view AT ALL, because iteration 8 dropped them as a money decision (they
  make a live authenticated request to metered search APIs the person pays for). The
  drift left standing WAS: a fourth first-party door added to `/api/connections`
  would silently never appear in the agent view.
  ✅ **GUARDED SINCE, and the plan said otherwise for four iterations after it was
  true.** `server.agent-connections-1034.test.js` compares the agent view's
  first-party COUNT against the board's doors minus `tokendoors.routes()`, with
  four controls including one asserting the subtraction is not a no-op. Proven by
  adding a fourth door to the board route alone and watching only that test go
  red. A reader of this plan would have concluded no guard exists.
  🛑 **AND THIS PARAGRAPH THEN WENT STALE ITSELF, WHICH ON THIS BRANCH IS THE JOKE
  WRITING ITSELF.** It said: *"Extracting a shared builder is the right fix and is
  deliberately not done inside a privacy change: it would edit the route the board's
  own screen depends on."* **The branch now does exactly that** (`askDoor`,
  `settleDoors`, `readFirstPartyDoors` in `server.js`), so the plan was the stale
  document on a branch whose entire subject is text that stops matching its code.
  ✅ **WHAT CHANGED, because the reversal is not a change of mind.** #1618 SHIPPED on
  `main` mid-branch, collapsing the board's shelf through a new `engine/inflight.js`.
  That converted the duplication from a tidiness question into a live defect: merged,
  the file held a collapsed sweep AND an uncollapsed hand-copy of the same three doors,
  on the route this branch tells every agent to poll. The merge was textually clean and
  both suites were green, so nothing could see it.
  ⇒ **The old reasoning was right while the copy was merely duplicated and wrong once
  one copy became the collapsed one.** Deferring would have shipped the stampede the
  route's own comments spend forty lines arguing against.
  📌 **And it closes the drift above structurally rather than by count.** The count
  guard catches a fourth door ADDED to one route and not the other; it is blind to the
  two drifting in BEHAVIOUR, which is the shape that actually occurred. One shared
  builder cannot drift from itself.
🛑 **A MEASUREMENT HERE WAS FALSE WHEN IT WAS TAKEN, AND ITS CONTROL MADE IT LOOK
VERIFIED.** This line read: *"Still open: `GPT` 0 in `engine/connections.js`, control
`provider` 9."* Re-measured at this branch's merge-base `7c936c55`: **`GPT` is 2**, and
the control is 9, matching the original to the digit.

⇒ **The control agreeing exactly proves it is the same file at the same moment, so the
GPT count was never 0.** A passing control next to a wrong subject is not verification;
it is the thing that stops anybody re-running the subject. On HEAD it is 3, and
`engine/connections.test.js` already carries a merged `#1552: the connect block names
GPT`, so the gap this line called "still open" had been closed before this branch started.

📌 Same class the rest of this branch is about, arriving in the plan file rather than the
code, which is where nothing executes it.

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
