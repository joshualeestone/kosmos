---
branch: panefixtures-1889
repo: joshualeestone/kosmos
issue: 1889
created: 2026-09-02
author: Mikey
---

# #1889: sweep the pane-scraper readers against a live Claude Code 2.1.258

## What the card asked

Drive a real 2.1.258 agent into each state the scraper recognises, capture the
pane verbatim, confirm `classify()` reads it, pin a fixture per state. The card
is explicit that static analysis cannot settle two shapes: a NEW format added
alongside an old one, and dynamically-composed lines no grep can see.

## Method

This machine runs 18 live Claude Code 2.1.258 panes, so the highest-value
captures were available without driving synthetic agents. Captures use the
PRODUCTION flags, which matters: `capturePane` passes `-J`, and without it pane
width is a hidden input to every rule in `classify()` (#1234). A sweep with
different flags would be testing a different string than the product reads.

## What was found

### 1. A working shape the scrapers miss, and it is #1884's exact class

Live on `icecreamkitty-discord:0.0`:

    ✻ Waiting for 1 background agent to finish

No gerund ellipsis and no parenthesised timer, so `WORKING_LINE` cannot match.
Measured with the scrapers alone: `classify()` returns `idle`, "it is sitting at
its prompt", on a genuinely mid-turn agent. Control shape returns `working`, so
the instrument discriminates.

**It was masked, which is why it survived, and my first description of the mask
was wrong in the reassuring direction.** I wrote that a "process read" caught it.
There is no process-classification arm in this module; a whole-repo grep returns
only my own prose. What actually masked it is the agent's **own self-report**:
`install/kosmos-report-hook.sh` fires `report working --auto "running <tool>"` on
PreToolUse, throttled to one line per 60s.

⇒ So the board was NOT independently right. It was right only where an agent
happened to be reporting, which is a much weaker guarantee than a second reader.
Any agent whose hook is absent, failing, or merely between heartbeats reads
`idle` while mid-turn. Measured at review time: `origin/main` returned `idle` for
EVERY pane carrying the shape.

⚠️ The correction makes the defect worse, not better, which is why it is worth
recording rather than quietly editing: the first version told a reader there was
a working backstop, and there is not.

**A static grep could not have found it.** The count is interpolated, so the
literal line is nowhere in the 2.1.258 bundle. That is the card's residual #2,
demonstrated against the reader it was filed about.

### 1b. It is a live population, and the count is a MOVING quantity

Splinter reproduced the sweep independently and found the shape on five panes at
15:37. My own sweeps minutes apart found three, then two.

🛑 **BUT SHOWING THE SHAPE IS NOT THE SAME AS BEING MISSED, and the difference
matters before anyone publishes a count.** A pane can carry the background-agent
wait line AND a normal spinner line at the same time; then `WORKING_LINE` covers
it and `classify()` is already correct. The missed state needs BOTH the wait line
present AND no working arm matching.

Measured, same minute:

| pane | shows the shape | WORKING_LINE | verdict |
|---|---|---|---|
| barondraxum | yes | false | **MISSED** |
| pigeonpete | yes | true | covered |

⇒ A count of panes showing the line OVERSTATES the misread population. Any single
number needs its timestamp attached, because agents enter and leave the state
between sweeps. "N of 18 at HH:MM" is defensible; "N agents classify as idle" is
not.

⭐ Worth recording because I nearly made the error myself: the first version of
this section said "3 of 18 are misread". One sweep later it was 1.

### 2. Only one of the three working arms fires on 2.1.258

Measured across the live working set:

| arm | result |
|---|---|
| `SPINNER` on `pane.title` | false, 9 of 9 |
| `INTERRUPT_LINE` | false, 9 of 9 |
| `WORKING_LINE` | true, 8 of 9 (the 9th is the miss above) |

`esc to interrupt` renders on **zero of 17** panes (control `bypass permissions`
hits 17 of 17), although the string IS in the bundle exactly as the card noted.

⇒ `WORKING_LINE` is a single point of failure. The other two look like
redundancy and provide none. If it breaks the way the auth reader broke, the
board goes quiet with no second arm, which is #1884 again.

Not "fixed" here: `INTERRUPT_LINE` is also the codex arm (`classify` uses it on
`codexTail` at one site and on the general `tail` at another), so removing it
would be wrong and widening it needs a live capture this fleet cannot produce.
Recorded as a measurement, not a change.

## The fix, and why it is narrow

Added `BACKGROUND_AGENT_WAIT`, keyed on the glyph exactly as `WORKING_LINE` is
and requiring the `background agent` phrase.

🛑 **A blanket `Waiting for …` rule would be a regression, not a fix.** The
bundle carries 24 distinct `Waiting for …` strings and they are not one state:

- autonomous waits: API response, CI, findings, server, task
- **blocked on a human**: permission, authorization, team lead approval, team
  lead to review and approve, leader to approve network access, sign-in to
  complete in your browser

Reporting that second group as `working` would hide an agent that needs you,
which is the false-calm direction this card exists to close, and the exact "the
fix for a finding introduces a worse finding" shape `status.test.js` warns about
above its footer row.

⇒ Only the ONE shape observed on a real pane is handled. The other 23 are a
named, unresolved risk, with an instruction in the code not to widen without a
live capture and to route human-blocked shapes to `NEEDS_YOU`.

## States not captured, stated plainly rather than quietly skipped

- **permission prompt** and **trust dialog**: not captured live. Both are already
  pinned from real captures (#1629 pins a raw trust-dialog capture including
  padding), and driving a fresh one means interrupting a working agent or
  standing up a throwaway agent, which I did not do inside this pass.
- **usage limit**: not reproducible on demand.
- **auth**: fixed and pinned in #1884.

So this card is **partially** discharged: it closes the highest-risk state (the
running turn) with a live capture and a real defect, and it does not close the
other three. Do not read the merge as the card being done.

## Verification

- New test pinned from the verbatim live line, plus the plural form.
- **Perturbed to prove it can fail**: replacing the regex with one that cannot
  match reds exactly 1 of 159 in `status.test.js`; restoring returns 159/159.
- Full suite `bash tools/run-tests.sh`: **exit 0**, 4537 lines, zero failures,
  and the new test runs inside it.

## Weakest premise

That the background-agent line is stable enough to key on. It is one observation
on one pane on one version. If the vendor rewords it, this reader dies exactly
the way the auth reader died, and the guard against that is the same guard the
card is about: capture a live pane after a version bump rather than grep the
bundle.
