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

    * ✻ Waiting for 1 background agent to finish   <- `*`-prefixed on purpose:
      an unprefixed copy makes THIS FILE match the reader it documents, so an
      agent that cats it would read `working` while idle.

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
three of the four panes carrying the shape at
2026-09-02 16:24 CDT. The fourth returned `working`, because it also had a live
spinner that `WORKING_LINE` covered. Stated with a timestamp because the fleet
moves, and stated as three-of-four because an earlier version of this sentence
said "EVERY ONE", contradicting section 1b of this same file, which exists to
stop exactly that absolute.

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
bundle carries many distinct `Waiting for …` strings (counted once, with its
command, in `engine/status.js`, because the number is extraction-dependent) and
they are not one state:

- autonomous waits: API response, CI, findings, server, task
- **blocked on a human**: permission, authorization, team lead approval, team
  lead to review and approve, leader to approve network access, sign-in to
  complete in your browser

Reporting that second group as `working` would hide an agent that needs you,
which is the false-calm direction this card exists to close, and the exact "the
fix for a finding introduces a worse finding" shape `status.test.js` warns about
above its footer row.

⇒ Handled: ONE counter phrase, `background agents?`, observed live. The composed
two-counter row matches through it. The workflow-only arm was added from JSX and
then removed (see below). Every other `Waiting for …` string is a
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
  match now reds 3 of 174 in `status.test.js` (the aimed assertion, the contract table and the reconcile row; re-measured after the rebase, and the
  contract table); restoring returns 160/160. The older "1 of 159" predates both
  the table and the extra test.
- Full suite `bash tools/run-tests.sh`: **exit 0**, 4537 lines, zero failures,
  and the new test runs inside it.

## THE FIX INTRODUCED THE DEFECT IT WAS CLOSING, AND A REVIEWER CAUGHT IT

Found at iteration 3. **The wait line is a TRANSCRIPT line, not an ephemeral
status row: it stays on screen after the background agent finishes.** So its
presence means "this agent waited at some point", not "this agent is waiting
now".

⇒ The first version of this reader reported `working` on a RESOLVED wait. On this
board `idle` means "it finished and is waiting for you", so it **hid a finished
agent** for as long as the stale line stayed within reach. That is a false calm in
precisely the direction #1889 exists to close, introduced by the fix for it.

🛑 Caught on MY OWN PANE: zero live subagents, an `⏺ Agent … finished` line on
screen, and my code saying `working`.

**The discriminator was already cited in my own comment and not used**: the live
`◯ <agent-type> … <elapsed>` footer row. Measured across six panes carrying the
line, `◯` was present on exactly the four genuinely waiting and absent on exactly
the two resolved.

⚠️ HISTORICAL, AND NOW INVERTED: this said `⏺` is NOT the discriminator, because
the `◯` gate of the time keyed on the wrong glyph. That gate was deleted at
iteration 9 as unsound. The SHIPPED resolution check keys on exactly `⏺`/`●`, as
the agent-completion bullet, and its perturbations red. Read the code, not this
paragraph.

📌 HISTORICAL: this described the `◯` liveness gate's fail-safe property. That
gate no longer exists (deleted at iteration 9). The principle it states survives
and still governs the reach and the resolution check: losing a true positive is
the acceptable direction, claiming a finished agent is busy is not.

## A FIX SILENTLY GUTTED FOUR OF MY OWN GUARDS, AND THE SUITE STAYED GREEN

Iteration 4, and the most useful finding on this branch.

The liveness gate from iteration 3 returns null **before any other check runs**.
So a NEGATIVE fixture without a `◯` row never REACHES the guard it claims to
test: it passes because the gate short-circuited, not because the guard worked.

Measured after iteration 3 landed, with the suite reporting 159/159 green:

| perturbation | should red | actually |
|---|---|---|
| delete the reach guard | yes | **green** |
| re-add `*` to the glyph class | yes | **green** |
| hoist above `asksSomething` | yes | **green** |
| widen to a bare `Waiting for` | yes | **green** |

Four guards, including the one the code calls "THE GUARD THAT MAKES THE RULE SAFE
TO HAVE", were vacuous. Their comments asserted the opposite in the same file.

🔑 **The error was one word in my own comment: a live `◯` row is "REQUIRED on
every positive fixture."** A negative fixture that cannot reach the guard under
test discriminates nothing. Every fixture now carries it, `notEqual` rows
included, and all six perturbations bite again.

⭐ **The general shape, which is the thing worth keeping: adding a new early
return retroactively disarms every test whose fixture cannot get past it, and
nothing goes red to tell you.** A guard is only armed relative to the code that
existed when it was written.

## A correction about my own perturbation instrument

The iteration-1 commit claimed "the perturbation reds 12 tests" for hoisting the
block above `asksSomething`. **The real number is 1, and the 12 was my
instrument, not the code.**

My perturbation script extracted the block by finding the next `  }` after
`evidence: bgWaitLine,` -- which is the object literal's brace, not the `if`
block's. So it moved an unbalanced fragment, left a dangling `}` behind, and
corrupted `classify()`'s control flow. The file still PARSED, and 12 unrelated
precedence tests went red, which read as broad redundant coverage.

With a brace-balanced perturbation (asserted balanced before use) the hoist reds
exactly **1** test: the one this branch adds. That is the honest state --
precedence is held by a single assertion, which is enough, but it is not the
depth the first number implied.

⭐ The lesson is the one this whole branch keeps re-learning: **the instrument
produced a reassuring number, and a reassuring number is the one nobody
re-checks.** A blind reviewer measured 1, I re-measured and got 12 twice, and
only inspecting what my script actually cut settled it. Assert your perturbation
is well-formed before believing what it tells you.

## THE COMMENT-RATIO TABLE WAS FALSE, AND SO WAS MY CORRECTION OF IT

Commit `4030a14f` published a table (siblings 3.5:1 and 5.0:1, mine 27.3:1 then
16.0:1, "a 3x outlier"). Commit `207bc2fa` then "corrected" it to 41 -> 42 lines
with the headline **the trim made the header one line longer**.

🛑 THE CORRECTION IS ALSO WRONG. Measured at the three revisions: 41 before the
trim, **36 at the trim commit**, 42 at HEAD. The trim DID shorten the block by 5,
and that accounts for the whole net change in its single hunk; the growth back to
42 came from the LATER commit. My 41 -> 42 comparison silently spanned two
commits and attributed a later commit's growth to the trim.

⇒ FOUR measuring attempts on this one quantity have now produced four different
answers, three of them published. So the number is retired rather than corrected
a third time: no comment:code ratio is quoted anywhere in this branch.

WHAT IS TRUE AND CHECKABLE WITHOUT THE NUMBER: the block is several times larger
than its siblings, the restructuring replaced a changelog with load-bearing
warnings, and the history now lives in this file. Anyone who wants the ratio can
measure it; I have demonstrated four times that I cannot.

⭐ The lesson is not "measure more carefully". It is that a derived statistic
nobody re-runs is the cheapest false claim to publish, and that CORRECTING one is
not safer than making one: my correction was published with the same confidence
and was wrong in the same direction.

## THE LIVENESS GATE WAS UNSOUND, NOT UNDER-ENUMERATED

Iteration 9, and the most important finding on this branch.

I spent three rounds patching `◯` sources one at a time: a live task row, then
the selected `❯ ◯` row, then the nested `└─ ◯` row, then the collapsed
`◯ N idle agents` summary. Each round I wrote a comment claiming the enumeration
was complete. Each round a reviewer found another.

🛑 **THE CEILING: EVERY footer row draws `figures.circle`.** Run state is carried
in the row's COLOUR (`wge = WL(task) ? undefined : Yge(status)`), and
`capturePane` passes `-p -J` with no `-e`, so colour is stripped before this
module sees the text. **The glyph carries no run-state information at all.** The
gate accepted completed, failed, idle, parked, header and summary rows as proof
of life: seven sources, of which I had handled one.

⇒ No further enumeration could have fixed it. The premise was false, not
incomplete, and every patch made the comment above it more confident.

✅ REPLACED WITH TWO SIGNALS THAT SURVIVE COLOUR-STRIPPING:
  - the REACH, now 8. Live status rows sit 3 to 5 rows above the composer, and
    the vendor can add a notification row, a two-row tip block and one row per
    queued message between them, so the realistic ceiling is about 7. Resolved
    waits have been observed at 7, 13 and 17 rows up: the 7 is the one that
    matters, because it is INSIDE the reach, which is exactly why the resolution
    check below earns its place rather than being redundant with distance.
    ⚠️ The suite is green only for [8, 14]. 8 is the exact lower edge, not a
    value with slack beneath it.
  - a POSITIVE COMPLETION MARKER: an `⏺ Agent … finished` line standing between
    the wait row and the composer means the wait is over, whatever the row says.

All seven false-calm sources now read `idle`; the genuinely-live control still
reads `working`; both new guards perturb red in both directions.

⭐ TWO THINGS I WOULD HAVE MISSED WITHOUT THIS. My resolved-wait fixture placed
the completed line BELOW the composer, a screen no render produces, so it was
testing an impossible pane. And five assertions pinning which `◯` rows proved
liveness were DELETED rather than adjusted: adjusting them would have preserved
the appearance of coverage over a premise that was false.

## WHERE THE DEFECTS ACTUALLY CAME FROM, AFTER TEN ROUNDS

The original defect took ten minutes to find and one line to describe. Everything
since has been my own work being wrong, and the split is worth recording because
it is not what I expected going in.

| round | found in | kind |
|---|---|---|
| 1-3 | the original reader, and my description of it | real, pre-existing |
| 4-6 | fixes I made in rounds 3-5 | self-inflicted |
| 7-8 | the vendor's render code, unreachable from live panes | real, latent |
| 9 | a subsystem I added in round 3 (unsound by construction) | self-inflicted |
| 10 | the redesign I shipped in round 9 | self-inflicted |

⇒ **Five of ten rounds found defects in code that did not exist before this
branch started** (4-6, 9 and 10; rounds 1-3 were pre-existing and 7-8 were latent
in the vendor's render). An earlier version of this sentence said seven, which
contradicted the table directly above it: a derived number going stale inside the
section about derived numbers going stale. That is not an argument against the loop: every one of those
was a real false calm or false idle that would have shipped. It is an argument
about what this kind of work costs. Scraping a vendor TUI means each fix has a
blast radius the fix's author cannot see, and the only instrument that reliably
found them was a reader who had not just written the code.

⭐ THE FAILURE MODE THAT REPEATED MOST, in one sentence: **a guard, a
measurement, or a claim that was true when written and silently stopped being
true when something else changed.** An early return that disarmed four
assertions. A cleanup that deleted the guards of the round before it. A comment
describing an anchor that had been replaced. A number measured against a design
that no longer existed. None of these fail loudly; all of them read as coverage.

## WHY THE RESOLUTION CHECK IS NOT REDUNDANT WITH THE REACH

The obvious simplification is to delete it and let distance do the work. That is
wrong, and the reason is in the vendor's code rather than in any pane.

The count is read as `let al = NZ ? …pendingBackgroundAgentCount ?? 0 : 0`, where
`NZ` comes from `let [UZ] = d(SD)`: `useState` with the setter DISCARDED. It is
computed once at mount and never recomputed, and the count is a frozen property
of the transcript message. **So the wait row does not stop rendering when the wait
ends.** It is a frozen transcript row that outlives its own wait, and the
completion notification is appended below it, in exactly the span the check scans.

⇒ A resolved wait row can and does sit within the reach (observed at 7). Distance
alone would call it live.

## A WIDENING I MADE WITHOUT A LIVE CAPTURE, AND HAD TO DELETE

I added a `dynamic workflows?` alternative to the matcher, derived from the render
JSX, three lines below this file's own rule saying not to widen without a live
capture of the shape.

🛑 A workflow-only wait then matched and could never be resolved by anything the
reader knows about, so such a pane read `working` forever: worse than
`origin/main` and worse than the defect this card exists to fix.

⚠️ AND THE REASON I FIRST GAVE WAS FALSE. I wrote that no workflow completion
string exists in the bundle. Both `Dynamic workflow "${name}" completed` and
`… failed: …` are there. A workflow arm plus its own resolution marker is
buildable; I closed the question with a sentence one grep refutes.
⇒ The deletion stands on the rule, not on that claim: widened from JSX with no
live capture.

⇒ Deleted. The composed form (`… 1 background agent and 2 dynamic workflows …`)
still matches through its agent phrase; only the never-observed workflow-only
render is given up. The rule was right and I broke it in the same file that
states it.

## REBASED, AND EVERY EARLIER NUMBER IN THIS FILE WAS ORPHANED BY IT

The branch was 41 commits behind `origin/main`, two of them touching
`engine/status.js` and `engine/status.test.js` (#1919's consent-prompt arm and
#1930's auth-staleness branch). Every measurement recorded above had been taken
against a base that will not be merged.

Rebased cleanly (0 conflict markers predicted, 0 encountered). Numbers re-taken on
the new head:

- suite: **174/174** (was 161; upstream added 13)
- all 15 perturbations still bite, including the two new `AGENT_FINISHED_LINE`
  arms, the structural flag, and the `reconcileReport` gate
- live behaviour unchanged: a live wait reads `working` with `backgroundWait:
  true`; a resolved one reads `idle`

⚠️ Any number in this file written before that rebase describes a tree that no
longer exists. Re-measure before citing.

## RULE 6 CAN VOID THIS ENTIRE READER, AND IT IS NOT FIXED HERE

The most consequential thing found in 16 rounds, and it is not in the reader.

`reconcileReport` gives a FRESH report precedence over the scrape, and
`install/kosmos-report-hook.sh` maps `Stop -> report idle --auto`. **Stop fires at
end of turn, which is exactly when this wait row is drawn** (the row replaces
`Worked for …`). So a hooked agent reports `idle` at the same moment its screen
starts saying it is waiting.

Measured:

| report state | board says |
|---|---|
| fresh idle | **idle** (this reader's verdict discarded, no conflict surfaced) |
| fresh working | working |
| none | working |

⇒ This reader helps where there is NO report, a STALE one, or a WORKING one. It is
voided where a fresh auto-idle exists: usually seconds on this fleet, because the
background agent's own tool calls re-heartbeat the parent to `working`, but the
WHOLE WAIT wherever that agent is quiet or does not share the hook session.

📌 THE ARGUABLE FIX IS IN RULE 6, NOT HERE. The Stop hook asserts THE TURN ENDED,
which is true and is not in conflict with "a background agent is still running".
The board conflates the two. Changing that precedence affects every agent on the
fleet, so it is raised rather than taken from this card.

⭐ Worth noticing about my own attention: I spent three paragraphs, a structural
flag and a dedicated test on rule 5, and never looked at rule 6 sitting directly
beneath it.

## Weakest premise

That the background-agent line is stable enough to key on. It is one observation
on one pane on one version. If the vendor rewords it, this reader dies exactly
the way the auth reader died, and the guard against that is the same guard the
card is about: capture a live pane after a version bump rather than grep the
bundle.
