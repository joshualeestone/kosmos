# Plan: drop the root-false-negative Aqua-session gate in resolve-install-user.sh (kosmos#2511)

## The bug (P0, demo/investor-critical)
The .pkg postinstall runs `resolve_install_user` as root (installd) to pick which
user to install for. On macOS 26, `_riu_has_gui_session` (`launchctl print
gui/<uid>`) FALSE-NEGATIVES from that root context even for a user sitting at the
physical console -> candidate 1 fails its session gate, candidate 2 was gated to
`owner_count==0` only -> hard REFUSE -> generic "installation failed". Proven by
Josh: a FRESH single-user account installing DIRECTLY at the console (not
screen-share) fails identically. On a single-user machine count is 0 or 1, so the
only thing that can refuse is the session gate -> confirms it is the gate, and it
is UNIVERSAL on macOS 26 (every investor double-click).

## The fix
A running GUI Installer.app owned by X IS proof X has a live Aqua session (you
cannot double-click a .pkg without one), so the `launchctl print` is redundant AND
is the false-negative. Change resolve_install_user:
1. candidate 1: `owner_count==1` and the uid resolves -> INSTALL for that owner,
   WITHOUT requiring `_riu_has_gui_session`.
2. candidate 2 (fallback): run whenever candidate 1 did not resolve (count 0 OR
   >1), install for the real physical console user, without the session print.
   Keep the `''|root|loginwindow` refuse (genuine headless/SSH).
3. Refuse only for no-owner + no-usable-console. Reword the refusal (drop the dead
   "no active window session" branch).
The `_riu_has_gui_session` sensor is kept defined but no longer called as a gate.

## Preserved / residual
- #1880 invoker-detection unchanged: a sole Installer owner still beats the
  console holder, so "install for whoever drives Installer" holds.
- ACCEPTED reversible residual (Splinter product call 2026-09-15, per Josh's
  "investors MUST be able to install"): a genuine multi-account/Screen-Sharing
  session may resolve to the console holder rather than a non-console invoker -- a
  refused install is the worse failure.

## Tests (tools/test-resolve-install-user.sh, 20 checks, all pass)
- arm-B regression: sole owner with the session print failing -> resolves (was refuse).
- arm-B single-user: owner==console, one uid, print fails -> resolves (Josh's case).
- invoker-preference preserved (owner beats console holder).
- ambiguous+console -> falls back to console; ambiguous+no-console -> refuse.
- CONTROL: headless (no owner, console=loginwindow) still refuses -- the fix is
  not "always resolve".

## Weakest premise
That the failure is the session gate (arm B) and not something else. Justified by
Josh's fresh single-user direct-console failure (only the gate can refuse there),
agreed by Angel + Splinter; the install.log RIU_REASON (Mona/Baron) would confirm
the exact string but is not required. If it later says "more than one account is
running Installer", revisit -- but a single-user failure rules that out.

## Ownership / integration
I own the resolver patch (this branch). Angel reviews the diff. Baron owns the
.pkg re-cut + notarize + re-serve and folds this fix + his postinstall #1670
bounded-retry (a different file) into ONE re-cut. Verify on a fresh single-user
install.
