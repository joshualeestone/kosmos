# Plan: #3108 regression guard — pin that the install resolver never prefers a session-backed owner in the multi-account case

## Context / decision being guarded
#3108 asked whether `resolve_install_user` (install/pkg-scripts/resolve-install-user.sh) should, in the
multi-account `owner_count>1` case, prefer a specific non-console invoker (an owner with an "active
session") over the console fallback. Decided **WON'T-FIX** with Splinter (card + cut owner), 2026-09-16:

- The pkg script runs as root under installd, **detached from Installer.app**, so there is no reliable
  root-context signal for which of several Installer owners invoked THIS install.
- The only non-console signal, `_riu_has_gui_session` (launchctl print gui/<uid>), **false-negatives**
  from that context (the exact reason #2511 removed it as a gate). As a *picker*, that asymmetry can
  install into a bystander owner's home (reopening #1880's silent misinstall) or convert an honest
  refuse into a wrong-home install.
- The safe signal ("the active session") reduces to the console user, which the console fallback
  already prefers.

So the resolver is correct as-is: `owner_count>1` ignores sessions and falls back to the console user
(or refuses when there is no usable console). This is an investors-must-install P0 file, so the decision
was NOT to edit it.

## What finished looks like
A test-only regression guard exists so a future edit cannot silently re-add session-based owner
preference ("signal (b)") without a red test. **No change to resolve-install-user.sh** — the guard is
purely additive test arms.

## Change (test file only)
`tools/test-resolve-install-user.sh`: three new whole-resolver arms (placed above the re-source line,
per the file's own "no full-resolver arm below this point" rule), using only the existing stubbed
sensors (STUB_CONSOLE / STUB_OWNERS / STUB_SESSIONS):

1. `owner_count>1`, exactly ONE non-console owner has a session, console usable → must fall back to the
   console user, NOT the session-owner. (The sharp discriminator: signal (b) would pick the owner here.)
2. `owner_count>1`, BOTH owners have sessions, console usable → falls back to console, never guesses.
3. `owner_count>1`, one session-backed owner, console=loginwindow → REFUSES, never converts the refuse
   into a session-owner pick (the exact #1880 reopen).

These are the "control that returns the dangerous answer": each fails if session-based owner preference
is re-added to the resolver.

## Why this is safe
- No resolver logic changes — off the P0 install path entirely.
- The arms pin CURRENT behavior (verified: all three pass against unmodified origin/main), so they add a
  guard without changing anything shipped.

## Verification
- `bash tools/test-resolve-install-user.sh` green, including the 3 new arms and the pre-existing suite.
- challenge-loop to convergence.

## Weakest premise
That the guard arms are discriminating (would fail if signal (b) were added). Confirmed by construction:
arm 1 and arm 3 expect console/refuse precisely where signal (b) would pick the lone session-owner.
