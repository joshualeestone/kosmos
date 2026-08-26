# kosmos#918 -- sandboxed board labels never get swept when the scratch dir is deleted directly

## Source

Follow-up from kosmos#883 (label-uniqueness fix), named as deliberately-not-fixed work in
that card's own challenge-loop. Full reasoning: `.claude/plans/sandbox-surfaces-883.md` in
the merged PR (#917), "deliberately NOT touched" section.

#883 fixed the collision: before it, every sandboxed install shared one board-plist launchd
label (`com.kosmos.board`), so two installs on one machine silently overwrote each other's
registration. The fix (a short deterministic hash suffix of `KOSMOS_HOME` on the label,
whenever `KOSMOS_HOME` differs from the real default) traded that for a different failure
mode: **every distinct `KOSMOS_HOME` now gets its own permanent, uniquely-labeled launchd
job.** `install/setup.sh`'s `uninstall()` only derives and removes the label matching
whatever `KOSMOS_HOME` is set to *at uninstall time* -- it never sweeps for other
`com.kosmos.board.*.plist` entries. A walk convention that uses a fresh scratch directory
per run and tears it down by deleting the directory (rather than running `--uninstall`
against that exact `KOSMOS_HOME`) leaves one permanently-orphaned launchd job per walk,
forever -- referencing a deleted tree, invisible to anyone who believes the scratch install
is gone.

Explicitly internal/low-severity: this affects only internal release-walk scratch installs
(a real end-user/tester install never sets `KOSMOS_HOME` non-default), so it does not block
the current install-confidence push directly. Picked up as fleet hygiene once the higher-
priority tester-facing items were clear.

## Verified before writing any code

- Confirmed the label derivation formula exactly (`install/setup.sh`, both the install and
  uninstall sides): `com.kosmos.board.$(printf '%s' "$KOSMOS_HOME" | shasum -a 256 | cut -c1-8)`
  whenever `KOSMOS_HOME` differs from the real default; the bare `com.kosmos.board` label
  otherwise.
- Checked where `KOSMOS_HOME` survives inside the written plist: NOT `EnvironmentVariables`
  (the heredoc never writes it there) -- only inside `ProgramArguments[1]`, the path to
  `$KOSMOS_HOME/bin/kosmos`.
- Found a REAL live example of this exact shape on this machine while investigating:
  `~/Library/LaunchAgents/com.kosmos.board.d8227f6b.plist`, whose `ProgramArguments[1]`
  resolves to `~/walkbases/kwalk-0545/home/bin/kosmos` -- confirmed that directory currently
  exists (an active walk in progress), so it is correctly NOT an orphan; left untouched.
- Confirmed `tools/clean-machine.sh` (a sandboxed install/uninstall test walker, not a
  production maintenance tool) and `engine/machine.js`'s `labelTruthCheck` (catches an
  *impostor* label pointing at the wrong file, not an *orphan* label whose file is
  legitimately its own but whose `KOSMOS_HOME` no longer exists) do not already cover this.
- Verified `/usr/libexec/PlistBuddy` is the right, already-installed tool for a structured
  plist read (`Print :ProgramArguments:1`), matching this codebase's existing use of
  `plutil` for plist validation elsewhere -- not a homegrown XML parse.
- Built a standalone sandboxed fixture (three plists: one orphaned, one live, one bare
  default) and ran the sweep loop in isolation before wiring it into `setup.sh` at all --
  confirmed it removes exactly the orphan, leaves the live one and the bare default alone.

## Fix

`install/setup.sh`'s `uninstall()`: right after the current install's own board-plist label
is removed (so it can never appear in the sweep's own glob and be double-handled), a new
inline loop:

1. Globs `com.kosmos.board.*.plist` in the launch dir (`AGENT_WORKFORCE_LAUNCH` or the real
   `~/Library/LaunchAgents`). The bare, unsuffixed `com.kosmos.board.plist` never matches
   this glob by construction -- confirmed the exact character-count reasoning, not assumed.
2. For each match, reads `ProgramArguments[1]` via `PlistBuddy` and strips the trailing
   `/bin/kosmos` to recover that label's own `KOSMOS_HOME`. A plist not shaped this way (a
   future format, a hand-edit) is left alone rather than guessed at -- and the shape check
   itself requires an ABSOLUTE path (`/*/bin/kosmos`, not the looser `*/bin/kosmos`):
   caught in challenge-loop iteration 2, the looser pattern's `*` can match zero-width, so a
   degenerate `ProgramArguments[1]` of exactly `/bin/kosmos` (no home prefix) derived an
   EMPTY `KOSMOS_HOME`, which then defeated both refusal signals below at once (an empty
   string reads `[ -d ]` false, and `dirname ""` is POSIX-defined as `.` -- a directory that
   always exists).
3. **The primary signal: does that `KOSMOS_HOME` still exist on disk.** If it does, the
   label is left completely alone -- this is what protects a live walk in progress (its home
   present, its own `--uninstall` just not yet run) from ever being booted out from under
   it. Only a confirmed-gone home is swept.
4. **A second signal, added in challenge-loop iteration 1: is the home's PARENT directory
   also readable right now.** A bare `[ -d ]` alone cannot tell a genuinely-deleted home
   apart from one that is merely transiently unreachable (an unmounted volume, a network
   share hiccup, an ancestor directory the process briefly cannot stat) -- and this sweep
   runs on every uninstall, unscoped to the one `KOSMOS_HOME` the caller actually named. If
   the parent is also unreadable, that reads as "cannot tell" (a `KOSMOS_HOME`'s own parent
   does not vanish on its own) and the label is left alone, rather than acted on as a
   confirmed negative.
5. Under a real (non-sandboxed) launch dir, the same `launchctl enable` + `bootout` +
   `rm -f` sequence the current install's own label removal already uses. Under
   `AGENT_WORKFORCE_LAUNCH` (a test harness), `launchctl` is skipped entirely (there is no
   real registration in a sandboxed dir to touch) and only the file is removed -- the same
   "no launchctl under a sandbox" rule this file already enforces for its own label.

Runs on **every** uninstall, not just a sandboxed one -- a real end-user's plain uninstall
now also cleans up any unrelated orphaned scratch-install labels it happens to find, which
is safe (it only ever removes a label independently, positively proven to be orphaned) and
matches the issue's own "or a periodic machine-cleanup pass" framing without needing a
second, separately-invoked tool.

## Explicitly not changed

- `engine/machine.js`'s `labelTruthCheck` (the impostor detector) is untouched -- it answers
  a different question (is a label pointing at the WRONG file) than this fix (is a label's
  own file's `KOSMOS_HOME` gone), and the issue's own framing treats them as separate.
- `tools/clean-machine.sh` is untouched -- it is a test walker, not where a production sweep
  belongs.
- No new standalone `--sweep-orphans` flag or periodic cron-style job. The issue offered
  "at uninstall time OR as part of a periodic cleanup pass" as alternatives; folding it into
  every uninstall covers the common case with the smallest change, and needed no new entry
  point.

## Test plan

`tools/test-install.sh`, a new `#918` section following the established fixture style, six
scenarios sharing ONE launch dir (the way multiple walk runs on one Mac would):

- **A and B** -- two sandboxed installs. A's `KOSMOS_HOME` is deleted directly (no
  `--uninstall`, reproducing the exact walk-convention shape #918 is about); a plain
  `--uninstall` of B (a completely different `KOSMOS_HOME`) must sweep A's now-orphaned
  label as a side effect, even though the uninstall never named it.
- **C** -- a third sandboxed install, left alive the whole time, to prove a still-live
  label survives a sweep it has no reason to trigger, and that its own `KOSMOS_HOME`
  directory is never touched (only its label is checked).
- **D, added in challenge-loop iteration 1** -- a genuinely DEFAULT `KOSMOS_HOME` install in
  the same shared launch dir, giving the sweep a REAL, unsuffixed `com.kosmos.board.plist`
  (the one label every normal end-user install has) to prove survives the actual shipped
  loop, not just the glob-exclusion reasoning in `setup.sh`'s own comment -- the single
  highest-stakes property this fix has, since a bug here would stop a real person's board
  from launching at their next login.
- **A hand-crafted degenerate plist, added in challenge-loop iteration 2** -- a
  `ProgramArguments[1]` of exactly `/bin/kosmos` (no home prefix at all), placed in the same
  shared launch dir, proving it survives the sweep untouched rather than being misread as a
  confirmed orphan through the empty-string derivation described above.
- **A plist PlistBuddy cannot even read, added in challenge-loop iteration 3** -- a
  syntactically valid plist with a real `Label` but no `ProgramArguments` key at all (the
  regression test for the BLOCKER that round found: an unguarded `PlistBuddy` command
  substitution under this file's `set -euo pipefail` would abort the WHOLE uninstall script
  silently, mid-function, the instant it hit this plist). The only assertion that actually
  proves the crash did not happen is the uninstall's own `rc_ok` check on its exit code --
  a `set -e` abort would have failed that directly, since this scenario's own board-plist
  removal happens earlier in `uninstall()`, before the orphan sweep ever runs.

`AGENT_WORKFORCE_LAUNCH` is pinned to a sandboxed directory for every step in this
scenario, matching the file's own `#946` safety rule (an unpinned launch dir with a
default `KOSMOS_HOME` would run `launchctl bootout` against the REAL board on the build
machine) -- since the sweep's own `launchctl` calls are already guarded behind the same
sandbox check, this also incidentally proves that guard fires correctly (the test never
needs real `launchctl` access to pass).

Full harness: `bash tools/test-install.sh` (after `KOSMOS_ALLOW_MINOS=1
tools/build-tmux-bundle.sh dist` and `tools/build-kosmos-bundle.sh dist`), all scenarios,
0 failures required before PR.

## Challenge-loop

Standard `/challenge-loop` to convergence before `/create-pr`, per house process.
