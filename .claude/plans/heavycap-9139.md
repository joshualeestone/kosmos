# heavycap-9139: QUEUED_HEAVY_CAP_S, a capped wait that runs beside an ordinary holder (kosmos#9139)

## Why
Relay CI on the Mortals runner runs its suites outside this Mac's heavy queue, so its load lands beside whatever holds the
queue. Joining the queue plainly would block every relay PR behind long queued runs. A cap lets a run wait at most N s
for an ordinary holder and then run beside it, while still waiting out a release cut.

## Plan
- [x] QUEUED_HEAVY_CAP_S=<s>: a deadline from when the run joined; past it one free turn in order, then beside (no claim,
      no renewer, noted with kosmos_note_beside_run so the holder's red summary names it). A release cut is waited out.
- [x] Review 1: clean beside environment; no spin beside a cut; queue order kept; a claimless cut counts.
- [x] Review 2: the cap is a deadline, not a fresh cap per wait; no retake spin; KOSMOS_NO_WAIT=1 turns the cap off.
- [x] Review 3: a beside run goes through the main-turn run code (group, TERM forwarding, watcher, label, END, rc).
- [x] Review 4: the queue place is kept through a cut wait; a SIGKILLed wrapper's watcher writes the end note.
- [x] Review 5: ONE beside run at a time (a slot, an mkdir lock); every pass of the cut loop after the first sleeps.
- [x] Review 6: a dead slot is broken only under the take lock; the slot records the command's group; small fixes.
- [x] Review 7: no spin at KOSMOS_WAIT_MAX_S=0; slot numbers checked by their start times; the cut limit stated.
- [x] Review 8: EPERM is alive; a command group counts only by its leader.
- [x] Every fix mutated; each mutation reds its arm (test-queued-heavy-4977: 199 OK).
- [ ] Full validation through queued-heavy, PR, merge on green; then the relay half (relaycap-9139) with a Mortals turn.

## Decisions
- The cut wait has no bound of its own: a cut holds Mortals about two hours and a suite beside it slows the cut (Baron).
- LIMITS, stated in the code: "never beside a cut" is checked when a run goes beside, not while it runs; a foreground
  (terminal) beside run records no group; a zombie wrapper reads live until reaped; read-to-remove gaps are builtin-wide.
- Not built here: making a live slot read busy to the cut and to _qh_clear (a change of its own).
- Weakest premise: that relay CI's command does not itself queue (a run-tests.sh inside a beside run waits behind the
  holder anyway, holding the slot; review 5 and 8 NITs).
- Reviews stopped at 8 (the usage cap); round 8's findings are fixed with arms, none left open.
