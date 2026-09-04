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
- **Perturbed to prove it can fail**: replacing `BACKGROUND_AGENT_WAIT` with
  `/(?!)/u` reds **4 of 175** in `status.test.js` (the reader test, the evidence
  contract, the reconcile row and the shape-contract table); restoring returns
  **175/175**. Earlier figures in this file said "3 of 174" and "160/160"; the
  first was true before the evidence contract was split into its own block, and
  the second was never true of any tree on this branch. Both are corrected here
  rather than deleted, because a number that was wrong is worth seeing.

  🛑 **AND THE FIRST VERSION OF THIS PERTURBATION WAS ITSELF DEFECTIVE, CAUGHT BY
  THIS MODULE'S OWN CONTROL ROW.** I first wrote the disabling regex as `/$^/u`,
  reasoning that end-of-input followed by start-of-input can never both hold. On
  a NON-EMPTY string that is right. On the EMPTY string position 0 is both, so
  `/$^/u.test('')` returns **true** -- and a captured pane's tail begins with a
  blank row, so the "disabled" reader fired on it and turned the module MORE
  working, not less. Six tests reddened instead of four, two of them unrelated,
  and the one that named the cause was the footer-alone CONTROL at
  `status.test.js:1453` -- a row whose whole job is to fail when a fixture leaks.
  ⭐ The lesson is not about `$^`. **A perturbation is a measuring instrument and
  gets no exemption from the rule it exists to enforce: if it reds something you
  did not predict, the instrument is a suspect before the code is.**
- Full suite `bash tools/run-tests.sh` on the iteration-19 tree (`ebffef4f`):
  **`SUITE_EXIT=0`**, terminal verdict `ALL PASS (33 arms)` present, 4666 log
  lines, node:test reporting **3899/3899** with `fail 0`, and the new tests run
  inside it. The lane was checked free first (`ps -eo pid,command | awk` for
  `tools/run-tests.sh`); a prior check found Baron's `platform-pins-1777` run
  holding it, so this waited rather than colliding.
  ⚠️ The figure here previously read "4537 lines" and was stale by several
  rounds. **A line count in a plan is a claim about a tree, and it goes stale
  silently**, so it is cited with the commit it was measured on.
  📌 The verdict is read from the TERMINAL LINE and the exit code, never from
  the absence of `FAIL` rows: a suite killed mid-flight prints a plausible
  passing tally and has no failures in it either.

## 2026-09-04 REBASE: A POSITIONAL API COLLIDED SILENTLY

The branch went **121 behind** overnight and all four of its files changed
upstream, so every number recorded before this describes a base that will not be
merged. Rebased; 33 ahead, 0 behind. **One real conflict, and it was semantic
rather than textual.**

`#2107` added a third parameter `runner` to `chat.waitingNote` and LANDED on main
while this branch was open. `#1889` added a third parameter `backgroundWait` and
had not landed. Both authors wrote "the third parameter" independently.

🛑 **THE COLLISION IS SILENT AT THE CALL SITE, WHICH IS WHY IT IS WORTH RECORDING.**
The types are compatible, so `waitingNote('working', PLACED, true)` still RUNS
against the merged signature: `runner === 'codex'` is merely false, `backgroundWait`
arrives `undefined`, and the wrong sentence is produced by a call that throws
nothing. **A positional API cannot report its own misuse.**

✅ Resolved by keeping BOTH, with the LANDED parameter holding its slot
(`state, outcome, runner, backgroundWait`) so no merged caller or test moves, and
the unlanded one taking position 4. My three test call sites moved.

📌 The only thing that caught it was `node --check` on a duplicated `const unsure`
that my own merge introduced. A syntax error is a lucky tripwire, not a guard:
**had I merged the two bodies without duplicating a declaration, the branch would
have been green and the sentence wrong.**

Verified on the merged base: status **177/177**, chat **120/120**, observed
**6/6** (all three counts higher than before the rebase, because upstream added
tests that now run beside these). Behaviour re-checked directly rather than
inferred from green: a live wait reads `working` with `backgroundWait: true`, a
resolved one `idle`, a wrap-joined completion `idle`.

⚠️ Full suite NOT yet re-run on this base. Every earlier suite figure in this file
is now orphaned by the rebase and should be read as historical.

## ITERATION 23: THE SAME DEFECT, ONE CONSTANT OVER, FOR THE FOURTH ROUND RUNNING

**Iteration 22 fixed the whitespace premise in `backgroundAgentWaitCount` and left
it broken in `AGENT_FINISHED_LINE` and `AGENT_WAIT_CLEARED_BANNER`.** Same class,
adjacent constants, same commit's blast radius. Measured, controls first (intact
rows return `idle`, so the instrument can return the dangerous answer):

    ⏺ Agent"a" finished                    -> working on a FINISHED agent
    ⏺ Agent "a"finished                    -> working on a FINISHED agent
    ⏺ Backgroundagent "a" was stopped ...  -> working
    ⏺ Allbackground agents stopped         -> working FOREVER after an interrupt
    ⏺ All background agentsstopped         -> working FOREVER after an interrupt
    ⏺ 3 background agents werestopped ...  -> working

⚠️ **REACHABILITY IS HIGHER ON THESE ROWS THAN ON THE WAIT ROW.** They carry a
MODEL-SUPPLIED description and the plural banner interpolates every one of them,
so they are the widest rows on screen and the likeliest to wrap. The fix landed on
the narrow row and missed the wide ones.

⭐ **THE PREMISE IS A PROPERTY OF THE TEXT, SO IT BELONGS TO EVERY REGEX THAT READS
THAT TEXT.** When one constant's assumption about a row changes, list the others
reading the same row and change them in the same commit or say why not. Four
rounds, four fixes, four adjacent sites left behind.

## A FIELD IS NOT COVERED BY TESTING THE FUNCTION THAT READS IT

`stateBackgroundWait` was published by two card builders, read by one consumer, and
asserted by nothing. **Hard-coding it `false` at both builders left all 296 tests
green** while every pane on a background wait went back to being told "it will not
read this until it finishes". The whole user-visible half of iteration 22, removable
with no signal.

The existing row called `waitingNote(state, outcome, true)` with a literal, which is
the FUNCTION and not the PATH, and this file's own header already forbids that
("EVERY CARD COMES FROM `test-support/fleet`, never from an object"). **The seam
that breaks is between producer and consumer, and only a test that crosses it can
see.** There is now one that builds a real card through `snapshot()` and delivers
through `deliver()`, with the reviewer's exact perturbation as its proof.

### Writing that test went wrong twice, in the same direction

1. I asserted `verdict.because`. The note is `verdict.paneNote`, and `because` is
   null on a successful delivery, so it read exactly like the feature being broken
   end to end.
2. I armed the fixture with two empty answers, so the delivery came back
   `unconfirmed` -- and `waitingNote` DELIBERATELY drops the settled-fact clause on
   an unconfirmed verdict. The sentence was correct and my fixture was measuring a
   different world.

Both times the red was real and its cause was mine. ✅ **The row now asserts the
VERDICT before the SENTENCE**, so a harness problem says so instead of impersonating
a product one. That one extra assertion is what turned the second failure from a
puzzle into a message.

## ITERATION 22: A BLOCKER LIVING BETWEEN TWO GREEN FIXTURES

**`BACKGROUND_AGENT_WAIT` spells every space `\s*`** on the `capture-pane -J`
wrap-join premise, and the branch asserts those joins as real renders.
**`backgroundAgentWaitCount` spelled them `\s+`.** So on exactly the rows the
matcher was widened to accept, N fell through to the unreadable-row fallback of 1
and one completion resolved a wait on N: the iteration-20 false calm restored, in
the wrap mode the module already treats as live. Measured, each reading `working`
alone and `idle` with one completion below it:

    ✻ Waiting for 2 backgroundagents to finish
    ✻ Waiting for 2background agents to finish
    ✻ Waiting for 3 background agentsto finish     (2 running agents hidden)

⭐ **TWO REGEXES READING ONE ROW MUST SHARE ITS WHITESPACE PREMISE.** Neither was
wrong alone. Nothing tested them TOGETHER: the wrap fixtures assert only `.state`
on a wait with no completions, and the count fixtures use unwrapped rows. **The
only fixture that can catch this is one that varies BOTH dimensions at once**, and
it is in now, with a both-completions control so it cannot pass by the reader
simply having stopped matching wrapped waits.

### Three more, two of them false calms

- **`chat.waitingNote` told a person their message would go unread.** A pane on a
  background wait classifies `working`, but its turn has ENDED and its composer
  takes the text immediately, so "it will not read this until it finishes" is the
  opposite of what happens. **The only one of this family a PERSON reads** (the
  siblings were rule 5 and the #1921 badge). The card now publishes
  `stateBackgroundWait`; polarity is `=== true` so absence keeps the old sentence.
- **The banner `continue` was unarmed.** It sits one line from the count
  `continue`, which WAS pinned. Perturbing the banner one to `return null` left
  the suite green while reading `idle` on a live agent below a banner-cleared
  stale row. ⚠️ **Splitting the two arms into separate constants is what left one
  unpinned** -- the split was made to keep them clear and it created the hole.
- **A composed wait was cleared by its agent half alone.**
  `Waiting for 1 background agent and 3 dynamic workflows to finish` plus one
  agent completion returned `idle` with three workflows running. The reader now
  DECLINES on a composed row. The bundle does carry `Dynamic workflow "x"
  completed`, but this branch's rule is to widen only on a live capture of the
  shape being widened to, and there is none. **Resolving on a marker I have not
  seen rendered would be the same error facing the other way.**

### Comments that misdescribed their own subject

- The focused-footer sentence claimed the vendor draws `pointer + " "` then the
  icon. It draws `[Zp, Vp, "  "]` with the pointer immediately followed by the
  icon and two spaces AFTER. The exclusion spells the gap `*` so nothing broke,
  and **that sentence had already been corrected once, in the other direction**.
- The suffix enumeration was missing a fourth child (`· N still running`). Inside
  the suffix group anyway, and gated so it cannot co-occur with the wait text.
- `Number.isFinite(n) && n > 0` is unreachable and now says so. Perturbing the
  line to `return n` leaves the suite green. **An unreachable expression that
  LOOKS like a guard is worse than no expression**: it tells the next reader the
  input is checked when nothing checks it.

⭐ **The pattern across iterations 19 to 22, stated once:** every defect this loop
found after the original one was introduced BY A FIX, and three of them disarmed a
guard rather than breaking a behaviour. **A green suite is evidence about the code
you changed and says nothing about the guards you moved out from under.**

## ITERATION 21: THIS BRANCH SILENTLY WEAKENS #1966's ACCOUNT BADGE

Found by a blind reviewer reading ACROSS the merge, which no test on either side
can do. The branch was 9 commits behind; one of them (`e8ac8f6e`, #1966) records
`observed.OUTCOME.OK` whenever `scrapedStatus.state === WORKING`, on the stated
grounds that a scraped WORKING is *"a WITNESSED live streaming turn, direct
evidence the token was just accepted for a real request."*

**This branch adds a scraped WORKING for which that is false by construction.**
The parent's turn has ENDED; the row is a frozen transcript line left behind by a
wait; the background agent runs in its own session against its own token. Nothing
is in flight from the pane being scraped, and the Settings account badge greens
off it.

⚠️ **AND #1966's OWN ACCEPTED ASYMMETRY DOES NOT COVER IT, WHICH IS THE PART
WORTH READING TWICE.** That comment already allows a stale `esc to interrupt` row
to record a brief OK, because *"the next ~60s sweep re-reads the pane (a finished
turn scrapes as idle, not streaming)"* and so a false green self-heals. A #1889
wait row is precisely the row that breaks that sentence: it is frozen, it outlives
its own wait, and every sweep re-reads it as WORKING while it stays in reach.
⇒ **The bound the acceptance rests on is removed, not merely tested.** A reader
who knows the asymmetry is accepted would conclude this case is covered. It is not.

Fixed by gating the OK arm on the STRUCTURAL `backgroundWait` flag the classifier
already sets, so the guard and the classifier cannot drift apart. Pinned by a new
row in `status.observed-1921.test.js`, proven both ways: **6/6 with the guard, and
the new row reds without it.**

### I nearly recorded a harness error as a confirmed defect

My first version of that fixture passed `screen:` without `state:`, so it was
arranged as `idle` while the engine classified it `working`, and `test-support/fleet`
refused with *"the fixture is measuring a different world than the test believes."*
**I took that red as confirmation of the defect and said so.** It was a real red
about a real disagreement, and its cause was entirely mine.
⭐ Same shape as the bulletin `an-anchored-pattern-matches-the-line-you-imagined`:
**when a check goes red, ask whether the harness or the product is wrong BEFORE
believing it.** The defect turned out to be real, which is the luckiest possible
outcome and no credit to the method. The corrected fixture is what proves it.

📌 Also fixed here: `AGENT_FINISHED_LINE`'s name class was `[^"\n]*`, so a
model-supplied description containing a quote (`⏺ Agent "fix the "foo" bug"
finished`) never matched and left the wait live on a finished agent. Widened to
`[^\n]*`, greedy to the last quote before the verb.

### The bundle settled the question I had shipped as unmeasured, and it settled it BETTER

I shipped the counted resolution on the argument that it is correct under both
branches of a fact I could not measure. The reviewer then measured it. `B_t`, the
`turn_duration` constructor, has three call sites and they do different things:

| site | behaviour |
|---|---|
| turn end | **APPENDS** and does not remove the previous row |
| park on keepalive | **REPLACES** -- filters out every prior `turn_duration`, recomputes the count from `keepaliveReasons`, passes `dr||void 0` so a zero goes as undefined |
| swarm end | appends a **duration** row with no wait text (three args, both pending counts undefined) |

⇒ **NO site appends a row per completion.** A new row appears only when the parent
runs and ends a turn. **A parent parked at its prompt keeps ONE frozen row while
completions pile up beneath it** -- the ordinary case for a waiting parent, not an
edge case, and precisely the world the counted rule is load-bearing in.

🔑 **And the count is the right population by construction.** `gje` counts a task
when `M.status==="running"||Fs(M.status)&&!M.notified`, admitting it to the agent
set only when `GE(M)&&M.isBackgrounded`. An already-notified agent has LEFT the
count and its notification sits ABOVE the row; every agent still inside the count
notifies BELOW it. That is exactly what this scan measures.
⭐ Worth keeping the distinction rather than merging the two arguments: **"safe
under both branches" makes a change SAFE. This makes it RIGHT.** The first was
enough to ship on and I would ship on it again; it is not as good.

### 🛑 A MINIFIED SYMBOL IS NOT UNIQUE, AND MY CHECK OF THAT CLAIM NEARLY REFUTED IT

I do not put a peer's bundle claim into a load-bearing comment without probing it.
So I ran `grep -abo 'function gje'`, took the first hit, dumped it, and got

    function gje(e){return e.replace(S6t,`\n`)}

an unrelated string helper. **Nothing in that output says "wrong function".** It
is a complete, plausible definition under exactly the name I asked for, and it
reads as a clean refutation of the paragraph I was about to write.

There are **two** `gje` definitions in the 2.1.258 bundle. The counter is the
second. The claim was right.

⭐ **This is the false-ZERO class inverted, which is why the trained instinct does
not catch it.** The fleet's rows are mostly about a search that returns nothing
when something is there, so the habit is to distrust an empty result. Here the
probe returned a confident, well-formed POSITIVE that was about different code.
✅ **Grep the full signature, never the bare name** -- `function gje({tasks:l` --
and **count the definitions before reading one**: `grep -c` on the name is the
whole check, and it is one command.

📌 Related and applied throughout: **the comments now cite bundle facts BY CONTENT,
never by byte offset.** My offsets and the reviewer's disagreed for the same site
(163877519 vs 161924505) because we anchored on different points inside one
expression, and every offset is void at the next Claude Code build anyway. A
quoted string is greppable a year from now; a number is not.

### Process finding: my reviewer brief had the shared-index bug in it

The iteration-20 reviewer perturbed `engine/status.js` IN THE WORKTREE while I was
editing the same file, restoring from a snapshot taken at its own start. Any edit
of mine inside those windows would have been reverted with no signal to either of
us. Nothing was lost (verified by probing thirteen distinct strings across both
files at `62631ece`), and the reviewer noticed and moved to a scratchpad copy
mid-run, unprompted.
⭐ **This is `commit -a` in a shared checkout wearing different clothes: a
snapshot-restore is a whole-file write, so it takes a colleague's concurrent work
under your own restore.** The worktree convention does not help, because author
and reviewer are deliberately IN THE SAME TREE. **The brief must say: copy the
files you intend to perturb into your own scratchpad and perturb there.** Fixed
for iteration 22 onward.

## ITERATION 20: ONE COMPLETION WAS ENDING A WAIT ON N

The resolution check asked "is there A completion line below this row", so a pane
drawing `✻ Waiting for 2 background agents to finish` with `⏺ Agent "a" finished`
beneath it resolved, and the SECOND agent read `idle` while it ran. **The error
grows with N**: on a wait for nine, one completion turned eight running agents
into a calm card.

Resolution is now counted. The row's own count is parsed off the row, per-agent
completions in the scanned span are counted, and the wait clears only when the
count is met. The two GLOBAL banners (`All background agents stopped`,
`N background agents were stopped by the user:`) are exempt and clear any N,
which is why they moved into a second constant.

🔑 **I COULD NOT SETTLE THE UNDERLYING FACT AND DID NOT NEED TO.** Whether the
vendor appends a FRESH wait row each time one of N completes is unmeasured; the
frozen-`useState` mechanism says the existing row cannot update itself, but says
nothing about a new one. The change is correct under both branches:

| if fresh rows ARE drawn | if they are NOT |
|---|---|
| the stale row now declines to resolve and returns `working`, the same verdict the live row below it gives | this is the only thing between N-1 running agents and an `idle` card |

⭐ **A decision that holds under both branches of an unmeasured fact does not
need the fact.** Worth separating from the cases on this branch where I did need
a measurement and went and took one: the test is whether the branches disagree,
not whether the fact is interesting.

### The repair that mattered more than the fix

Making resolution count-aware **silently made the stale-row test vacuous**. Its
fixture waited on two with one completion, so it stopped declining at the FIRST
row and returned `working` without ever looking at the second, which is the
behaviour the assertion is named after. Right verdict, reached without exercising
anything. The fixture now carries two completions so the first row genuinely
resolves and the second is what produces the verdict, and it was re-verified to
discriminate by restoring `return null` in place of the resolution `continue`.

⚠️ **THAT IS THE SECOND TIME ON THIS BRANCH A CHANGE DISARMED A GUARD IT WAS NOT
AIMED AT** (iteration 19's narrowing disarmed the `[⏺●]` anchor fixtures the same
way). **A guard is armed only relative to the code that existed when it was
written.** After any narrowing or tightening, re-perturb the guards AROUND the
change, not just the assertion you aimed at. Neither instance produced a red.

### Three comments were false about their own code

Also fixed at iteration 20, all found by a blind reviewer running the claims
against the tree rather than reading them:

- Two `KNOWN LIMIT` notes marked **"(measured)"** (`⏺ Agent(<description>)` tool
  headers and `⏺ Agent work finished …` narration) described limits that
  iteration 19's narrowing had **closed as a side effect**. Left on the page,
  rewritten as closed, with the note that they were closed accidentally and any
  future widening reopens both at once.
- The `NO m FLAG` rule named the wrong mechanism. Per-row-ness comes from the
  `split('\n')` in `backgroundAgentWait`, not the flag: adding `m` leaves the
  suite green, and the no-`m` pattern **already spans rows** when the row is
  first in the input, because `\s*` matches a newline (measured).

⭐ All three were true when written. **A comment is a claim with a timestamp
nobody renders**, and the ones that go stale first are the ones that cite a
measurement, because the citation is what stops the next reader re-taking it.

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
    waits have been observed at 7 and 13 rows up (the source comment records the same pair; an earlier version of this line added a 17 that appears in no other record of the measurement): the 7 is the one that
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

- suite: **174/174** (was 161; upstream added 13). ⚠️ Superseded at iteration
  19: splitting the evidence contract into its own block makes it **175/175**.
  This row is the value AT THE REBASE and is left as written, because a
  snapshot that is quietly edited forward stops being a snapshot.
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

## I DELETED A WARNING ABOUT CLEANUPS REMOVING GUARDS, AND THE DELETION REMOVED GUARDS

Iteration 18, and it is the branch's defining failure in its purest form.

A reviewer suggested trimming purely-archival comment paragraphs. One of them was
the note recording that iteration 9's cleanup had deleted iteration 8's evidence
guards as collateral. My regex for cutting it included the closing `*/`.

⇒ The comment was left UNCLOSED, so it ran to the next `*/` and swallowed the two
assertions beneath it. **The suite still reported 174/174**, because a
commented-out assertion does not fail, it simply stops existing.

🛑 A GREEN TEST COUNT CANNOT SEE A DISABLED ASSERTION. The test count did not
change, no row went red, and nothing in the run said anything. I caught it only
because I counted `/*` against `*/` after a cut that I knew had touched a
terminator, and then re-perturbed the two guards to confirm they bit again.

⭐ SO THE LESSON THE DELETED PARAGRAPH WAS CARRYING IS TRUE ENOUGH TO HAVE
DESTROYED ITS OWN RECORD: a cleanup that removes a guard is the same defect as a
fix that never lands, and both are invisible to the suite. The only instrument
that sees either is a perturbation aimed at the specific guard.

✅ AFTER ANY COMMENT EDIT, COUNT THE MARKERS AND RE-PERTURB. `node --check` passes
on an unclosed block comment, and so does the whole suite.

## Weakest premise

That the background-agent line is stable enough to key on. It is one observation
on one pane on one version. If the vendor rewords it, this reader dies exactly
the way the auth reader died, and the guard against that is the same guard the
card is about: capture a live pane after a version bump rather than grep the
bundle.
