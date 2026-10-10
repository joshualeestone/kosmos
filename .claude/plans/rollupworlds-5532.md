# rollupworlds-5532: every Kosmos on an enrolled computer reports (board half)

Card: kosmos#5532 (E0.3), umbrella #5529. Design comment on #5532: 6091394569. Relay half: kosmos-relay branch
rollupworlds-5532 (the coordinator accepts and stores a rollup per Kosmos on the enrolled computer; at most 16).

## Why
Josh, #admin 2026-10-09 08:43: "whatever happens on their work machine is company property". The rollup (#5665)
shipped before that ruling, so only the enrolled Kosmos reports.

## The change
- `engine/orgrollup.js` `tick`: after a SUCCESSFUL send of the enrolled Kosmos, `sendOthers` sends one rollup for each
  other Kosmos on the computer, same reason (daily or change), same accepted words and computer print, each under its
  own opaque id, and ONLY when those words name every Kosmos on this computer (`orgenroll` `NAMES_EVERY_KOSMOS`,
  `/\bevery kosmos on this computer\b/i`, the phrase the coordinator's CONSENT_NAMES_EVERY_KOSMOS is pinned to,
  kosmos-relay#354): otherwise no other Kosmos is read or sent. Before each send the enrollment and its consent hash
  are read again, so a Leave or new words during a read stop every later send. A partial read of another Kosmos is
  never sent. A change send skips a Kosmos whose signature did not move (kept per id in the state, `others`).
  Usage is withheld unless the words name it, as for the enrolled one; the policy version is left out (the company's
  policy is the computer's, reported by the enrolled Kosmos). A refusal past the coordinator's cap
  (`org_rollup_too_many_worlds`) stops the rest. Nothing of another Kosmos goes when the enrolled send fails, or after
  a leave lands.
- `otherWorlds(root)`: every Kosmos in this install's registry except `root` (hidden ones too: hiding stops agents,
  the Kosmos is still on the computer), at most 15, each with the environment an agent of it gets (pre-world roots,
  `KOSMOS_WORLD`, `applyAgentWorldEnv`). A folder that is none of the registry's Kosmoses (a sandbox, a folder given by
  hand) has no others.
- `engine/orgrollup-child.js`: `gather` reads one Kosmos's inventory in a child process with that Kosmos's folders
  (no reader changes) and mints its opaque id in its own data root; `tick` runs the enrolled Kosmos's own tick.
- `server.js` `orgRollupTick`: when the board on screen is not the enrolled Kosmos, it finds the enrolled one among the
  others and runs its tick in a child with its folders (its words, timing, print and key).

## Decided
- The others follow the enrolled Kosmos's schedule: a change in another Kosmos alone reaches the company at the
  enrolled one's next send (at most a day later). Splitting the tick into per-Kosmos timing would rework a tick that
  took 37 reviews; this is the smaller change, and the daily send always carries every Kosmos.
- Each other Kosmos's read takes a child process (at most 2 minutes each), only when the enrolled Kosmos sends.

## Gaps, stated
- The child's real `gather` is not run in a test: it reads the computer's live panes (status.snapshot), which on a
  test machine are the fleet's. Its unknown-mode refusal is tested, and the parent's handling of what a child returns
  is tested through the injected `gatherIn`.
- The server path that runs the enrolled Kosmos's tick from another Kosmos's board has no test (it is inside
  `orgRollupTick`, which has no seam).

## Weakest premise
That a reader's answer depends only on the folders in the environment and the shared Claude config folders, so a
child reproduces what that Kosmos's own board would report.

## Contract for usage (from the relay half's review)
The coordinator sums usage across a member's Kosmoses. So each Kosmos must report only its OWN agents' usage. Today
no usage leaves the board (no usageByDay source is wired, and the coordinator refuses usage), so nothing is double
counted. When the usage reader is wired, it must be scoped to the Kosmos's own roster (engine/usage.js
worldUsageByModel already is); a reader that scanned a shared config folder without that scope would count one
agent's tokens once per Kosmos.

## Challenge loop notes
- Iteration 1 (Opus): [BLOCKER] the review 24 guard test looked for the literal `require('./engine/orgrollup').tick()`, which the widening removed, so it read as ungated and reddened the suite: it now finds both send sites (this board's tick and the child tick) and asserts the live-execution gate precedes each. [WARNING] no re-check between another Kosmos's read and its send: added, as the enrolled tick does. [WARNING] a partial read of another Kosmos was sent as its daily: never sent now (the next full read carries it). [WARNING] the child tick's 30-minute bound was below the worst case: TICK_CHILD_TIMEOUT_MS from OTHERS_MAX and GATHER_TIMEOUT_MS. [WARNING] the child relied on exiting by itself: it exits once its line is flushed. [WARNING] the server searched for the enrolled Kosmos in the capped list: `otherWorlds(root, { all: true })`. NITs: the tick JSDoc back above `tick`; one id read twice goes once; a failed read drops its signature (safe direction, commented). Tests for the re-check, the partial skip and the duplicate id; each mutated red. Decided: no test of the child's real gather (it reads live panes; a test would read this computer's real data), as stated in Gaps.
- Iteration 2 (Sonnet): [WARNING] a cap refusal mid-loop dropped the signatures of the Kosmoses not yet reached, so the next change send resent them all into the cap: they now carry forward (test; mutated red). A Leave or new words still drop them, and so do words that stop naming every Kosmos (decided: new words start clean, as the enrolled Kosmos's state does; a daily resends everything anyway). [WARNING] a failed child tick was silent: logged now; one board per computer is the stated premise behind ORG_ROLLUP_RUNNING. [NIT] a dead `!g.partial` check removed. Decided NIT: the registry is read each tick from a board serving another Kosmos (small; a computer with one Kosmos returns at once on its own registry).
