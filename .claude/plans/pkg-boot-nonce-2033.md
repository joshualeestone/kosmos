# #2033: the pkg install path opens an authenticated ?boot dashboard

## Problem (confirmed by trace; Angel's weakest premise resolved)

A fresh .pkg install runs setup.sh with `KOSMOS_INSTALL_PAGE=1` (postinstall exports it). That
branch printed "your browser is already showing the install page; it becomes your dashboard now"
and **skipped the mint+?boot open** the else (curl|sh) branch does. But installing.html links the
board at a **BARE url**, which 403s on an enforcing board (0.6.25+, #1946) with no cookie -- the
same empty board as the #2023 auto-update outage. The else branch mints a nonce *precisely* to
avoid this (its own comment). So the pkg path knowingly skipped the one authenticated open the
non-pkg path does for exactly this reason.

The repair marker is gated on `_minted_nonce && _opened` (setup.sh), and the install-page branch
set neither, so `.reauth-seeded` was not written -- a FUTURE auto-update would repair, but the
pkg install itself stayed cookie-less until then or a manual `kosmos open`. For a fresh install of
the latest version there is no imminent next update, so a first-time pkg tester had no automatic
recovery.

## Fix

Move the mint+open out of the `else` so it runs in BOTH cases; only the message differs. The ?boot
open sets the httpOnly cookie for the origin, so the already-open install page (same origin) works
too once it becomes the dashboard. The page cannot mint for itself (no board token -- the same
reason #2023's in-app self-open button was dropped), so the fix is setup.sh-side. The seed still
gates on `_minted_nonce && _opened`, so the pkg path marks itself repaired exactly when it truly
authed, identically to the curl|sh path.

The else-body was already at 2-space indent (not deeper), so this is a minimal structural change:
close the INSTALL_PAGE if/else after the two messages, and let the (unchanged) mint+open run
unconditionally. sh -n and bash -n both pass.

## Deliberately unchanged
- installing.html's bare link is now harmless (the ?boot open sets the cookie for the origin), so
  it is left as-is -- the page cannot build a ?boot url itself (no nonce, no token).
- The mint+open logic is UNCHANGED (moved, not rewritten); its ?boot behavior is covered by
  cli.open-1957. This change only makes the INSTALL_PAGE branch REACH it.

## Test

An arm in tools/test-install.sh: a fresh KOSMOS_INSTALL_PAGE=1 install must STILL open the
dashboard (opened.log grows, carries the board origin) and print the new sign-in message, not the
old "already showing" one. Red-capable: the message assertion greps the exact new message and
against the exact old one (mutually exclusive), so reverting setup.sh reds it; verified the arm
passes with the fix (313 pass / 2 fail, the 2 being an older local bundle vs this 0.6.26 branch,
not the change -- CI builds a matching bundle). Positioned LAST so its full-install side effects
do not pollute earlier count/state probes.

## Weakest premise
Not reproduced on a real built+installed .pkg -- the trace is unambiguous and it is the identical
cookie-less-enforcing-board failure #2023 fixes for the update path, but a real pkg repro would
make it certain.
