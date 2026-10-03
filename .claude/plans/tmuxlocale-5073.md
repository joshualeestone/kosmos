# tmuxlocale-5073: tests that read the live tmux depend on the fleet and the caller's locale

Card: joshualeestone/kosmos#5073 (Baron's 0.7.19 re-cut abort, 2026-10-02 18:11: five node reds from a cut with no
LANG, launched through `tmux run-shell`).

## Product question first (the card asked it): does a board without LANG refuse to create agents?
Not for an installed board. Its launchd job pins `LANG=en_US.UTF-8` (install/setup.sh, the board job and the
watchdog job), and every agent's job does too (engine/create.js plist). install/kosmos also exports
LANG="${LANG:-en_US.UTF-8}" on every start through the command. The only uncovered path is a bare `node server.js`,
and engine/status.js already refuses a mangled line rather than parse it (the 08-22 fix). Not changed here.

## Decisions
1. **The boundary, once:** tools/run-tests.sh calls `kosmos_test_locale_pin` (tools/lib/test-locale.sh) before the
   suite. Caller has no locale at all (LC_ALL, LC_CTYPE, LANG empty): export LANG=en_US.UTF-8 and say so. Caller
   chose a non-UTF-8 locale: change nothing, warn that tmux-reading tests will fail for that reason. Same principle
   as the CODEX_HOME strip a few lines above it (#2858): guard the runner once rather than each test.
   Rejected: overriding a caller's explicit locale (LC_ALL=C is a choice; the warning names it instead).
   Rejected: pinning LANG inside every engine tmux call (about ten exec helpers across modules; the installed board
   already has a locale).
2. **The two proven files stop reading the live fleet:**
   - engine/create.runner-dir-1616.test.js: `status.setPaneSource(() => '')` before each test, as
     create.spoken-name-1367.test.js does, so createAgent's free-name check sees an empty fleet.
   - engine/last-look.test.js "a tmux that answers": its own tmux server (TMUX_TMPDIR in a short /tmp folder, a
     session it creates and kills), LANG set explicitly, TMUX cleared so a run inside tmux cannot attach to the
     caller's server.
3. tools/test-test-locale-5073.sh (wired into test:shell): six behaviour legs in `env -i` shells plus a source leg
   (the pin precedes the node suite). Mutant (no export) reds the first leg (measured).

4. tools/lib/cut-rerun-guard.sh (review round 3): the cut's isolation rerun re-runs a failing file with a bare
   `node --test`, outside run-tests.sh, so it now applies the same pin in its subshell. That rerun is what called the
   card's reds "real, 3 out of 3".

## Weakest premise
Other tests read the live tmux too (a sweep found about 30 files that reach createAgent/setProvider/snapshot/
paneRoster with no setPaneSource). Those are CANDIDATES, not findings: many use other seams. With the locale pinned
at the runner, the locale half is closed for all of them; the fleet half (a busy box changing a result) is closed only
for the two proven files. Converting the rest one by one is not this card.

## Verification
- tools/test-test-locale-5073.sh: 7/7; mutants (whole export line removed; only the `export` keyword removed) each red
  a leg (run 2026-10-02 18:54 and 18:58 CDT).
- The two node files: NOT run yet (a suite was live). Run both alone with no locale (env -u LANG -u LC_ALL -u LC_CTYPE) and with LANG, before
  the PR; the card's measurement is 6 pass / 4 fail without LANG on main for runner-dir.
