# board-plist-guard-2397 - runtime board-autostart check (#2397)

Owner: Ice Cream Kitty (native/coordinator). Kosmos beta-launch relevant (Josh's beta
requirement: install + permissions correct).

## The problem (Josh, 2026-09-07)

> "I just want to make sure we remember that we do that so it doesn't later on get accidentally
> deleted and screw white-collar workers who are wondering why it didn't start up."

Kosmos auto-starts the board via `~/Library/LaunchAgents/com.kosmos.board[.<hash>].plist`
(`RunAtLoad=true`). The risk is **invisible until reboot**: if that login job goes missing, Kosmos
silently will not start on the next restart, with no error at the time it breaks - the
`a-guard-that-only-checks-too-many-cannot-see-zero` failure class.

## What already exists (measured; do NOT duplicate)

- **Ask #1 (board RunAtLoad regression):** `tools/test-install.sh:487-499` runs `/setup` in a sandbox
  and asserts the board plist exists, runs at login, valid XML, carries port/locale/tmux.
- **Ask #1 (agents):** `engine/create.test.js:315-316` asserts agent plists carry `RunAtLoad`+`KeepAlive`.
- **Ask #2 (sweep/uninstall never removes a LIVE board):** `install/setup.sh`'s orphan sweep
  (~1300-1398) only removes a SUFFIXED label whose `KOSMOS_HOME` is confirmed gone; the bare default
  board never matches the glob. `engine/remove.js` deletes nothing on disk, ever; `engine/
  delete-leftover.js` is keyed on an agent name (`com.<name>.plist`) and refuses a live agent - so
  neither can reach `com.kosmos.board`.

## The gap this closes

Nothing detects the board's OWN login job going missing **at runtime**. `machine.labelTruthCheck`
answers "does any registered label point at the WRONG file" (an impostor) and returns OK when a job
is simply gone - exactly the cannot-see-zero hole.

## The change

Add `machine.boardAutostartCheck(runner, opts)`, wired into `machine.check()` (the board's "check
this computer" surface), asking the zero question about `com.kosmos.board`'s login job. It keeps
Josh's missing-vs-disabled fork (folded from #2395) intact:

- plist FILE missing on an installed bundle → **ATTENTION** (won't start at login; reinstall restores).
- plist missing running **from source** → **OK, benign** (`update.installedRoot()` gate; no dev false alarm).
- plist present + a standing `launchctl disable` override (what the Login Items toggle writes) →
  **ATTENTION, surfaced plainly, NEVER fought** (points at the toggle; force-re-enabling can get
  Kosmos flagged by Background Task Management - Josh's comment #2).
- plist present + enabled, or the toggle unreadable → **OK** (presence + `RunAtLoad` is the
  reboot-bearing fact; not-loaded-right-now is not a fault).
- non-darwin → row omitted (no launchd).

**Detection only:** it never mutates launchd (same conservatism as `boardrestart.js`), because at the
file layer a deleted plist and a user-disabled job are two faults with two right answers - surfacing
is the safe superset. A heal/notify arm is a deliberate follow-up on #2397.

**The only runtime probe is `launchctl print-disabled` (read-only):** `RunAtLoad` reloads a present
plist at the next login on its own, so a standing disable override - not "loaded right now" - is the
sole thing that stops a reboot start.

A shared `launchAgentsDir()` helper is extracted so the `process.env.HOME` fallback (the #1732
Windows-coupling `env-home` family) lives in ONE place, keeping that audit's count at 1.

## Tests

8 new `#2397` cases in `machine.test.js` (all branches + a never-mutates-launchd guard + non-darwin
omission), plus the `check()` wiring test updated 4→5 rows. Perturbation-armed (flipping the
missing-branch verdict reds the missing-job test). `machine`+`boardrestart`+`create`+#1732 audit =
green; full `tools/run-tests.sh` green.

## Rejected / deferred (with reasons)

- **Auto-recreate a deleted plist / auto-re-enable** - Josh's comment #1 says re-create is safe in
  the abstract, but at the file layer deleted and user-disabled read the same, and comment #2 forbids
  fighting a user's toggle. Detection that surfaces both is the safe superset; the heal arm is a
  follow-up.
- **Runtime per-agent RunAtLoad loaded-check** - larger surface (roster join); board first (the app
  coming back is the precondition). Agent plists are already guarded at creation.
- **Folding presence into `labelTruthCheck`** - its "impostor path, not existence" contract is pinned
  by its own comment + tests; a sibling row is cleaner than fighting it.

## Weakest premise

That the board's login-job label is the bare `com.kosmos.board` for every real user. True by #883's
design (the hash suffix is only for non-default `KOSMOS_HOME` sandbox/walk installs that must never
touch launchd) and the same assumption `boardrestart.js` makes. Would change if a real (non-sandbox)
install ever ships under a suffixed board label.

## Delivery

agent-workforce PR for the Kosmos team to review; repo squash-merges. Card #2397 stays open pending
Josh's 0.6.46 fresh-install re-test to confirm the row renders live.
