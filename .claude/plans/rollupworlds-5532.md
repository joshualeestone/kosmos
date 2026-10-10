# rollupworlds-5532: every Kosmos on an enrolled computer reports (board half)

Card: kosmos#5532 (E0.3), umbrella #5529. Design comment on #5532: 6091394569. Relay half: kosmos-relay branch
rollupworlds-5532 (the coordinator accepts and stores a rollup per Kosmos on the enrolled computer; at most 16).

## Why
Josh, #admin 2026-10-09 08:43: "whatever happens on their work machine is company property". The rollup (#5665)
shipped before that ruling, so only the enrolled Kosmos reports.

## The change
- `engine/orgrollup.js` `tick`: after a SUCCESSFUL send of the enrolled Kosmos, `sendOthers` sends one rollup for each
  other Kosmos on the computer, same reason (daily or change), same accepted words and computer print, each under its
  own opaque id. A change send skips a Kosmos whose signature did not move (kept per id in the state, `others`).
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
