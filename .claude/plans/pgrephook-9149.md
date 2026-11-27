# pgrephook-9149: the job-cleanup hook's pgrep under LC_ALL=C, with no rollout (kosmos#9149)

## Why
The last pgrep of #9149's class. The cleanup hook is written out as job-cleanup.sh and runs as its own process, so the
pgrep wrapper #9195 added does not reach it; the runner's .env sets a UTF-8 LANG, where pgrep exits 3 whenever any
process's name is not valid UTF-8, and the hook then killed nothing.

## Plan
- [x] The hook's pgrep under LC_ALL=C (nine bytes; nothing else in the hook changes).
- [x] verify: an installed copy of the PREVIOUS cleanup hook (a frozen sha256, HOOK_CLEANUP_PREV_SHA, measured from main)
      is a note ("run install again"), not "something rewrote it"; anything else is still a problem. So the change needs
      no coordinated reinstall of every runner.
- [x] Arms: the hook lists a leftover under a pgrep that refuses unless LC_ALL=C; verify reads the previous hook as a note
      and an edited one as a problem. Each red under its mutation (no LC_ALL=C; no previous-version branch; a wrong sha).
- [x] Review 1: the previous text was derived from today's (a later edit would widen it) --> frozen sha. Review 2: clean.
- [ ] Proof, PR, merge on green.

## Decisions
- A runner with the old hook reads as a note, not a problem (review 2 NIT): flagging it would put every runner red until
  reinstalled, which is the rollout this avoids. install always rewrites the hooks, so the next install fixes it.
- The fixture is today's hook minus the nine bytes and must hash to the frozen sha: the arm goes red if the hook is edited
  again, the cue to drop the previous-version acceptance or refreeze it.
