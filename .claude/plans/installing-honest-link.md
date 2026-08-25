# Plan: installing-honest-link

Splinter, peer UPDATE 2026-08-25 ~15:35, relaying Angel's finding on the
"Open Kosmos" link shipped in #892/#893 (`installing-progress`): the
"astronomically low odds" premise the link's copy shipped under is wrong.
`install/kosmos`'s `healthy()` (#664) checks "is *a* Kosmos", not
"is MINE" -- it curls the port and matches the response body generically.
`cmd_start` runs it FIRST, before any bind attempt. On a shared Mac with
more than one macOS account, this means the taken branch's board is
someone else's 100% of the time a second account starts Kosmos while
another account's is already up -- the ordinary case, not a rare one.

Pigeon Pete's follow-up (HEADS-UP): no veto on 0.5.33 -- ships as-is,
this fix lands for the next cut. His framing: soften the label/copy so
it offers "open what is answering" rather than implying "your Kosmos";
wording is my call.

## Changes

1. **The "already running" sentence names the common case.** Added: "On
   a Mac with more than one person's account, this is often THEIRS, not
   yours." -- instead of only describing the mechanism (something is
   answering) without saying how often it's a stranger's.
2. **The link is retitled "Open it anyway"**, replacing "Open Kosmos" --
   the old label implied an ownership the page cannot verify.
3. **The fallback line is rewritten as a clean backout**, not a
   redirect: "If it is not yours, close it without changing anything.
   Your own copy of Kosmos is in Applications." The old copy ("open
   Kosmos from Applications instead") read as though the reader should
   still go find their own Kosmos right now, rather than simply leaving
   the stranger's board alone.

## Explicitly not built

A real `isOwnAccount` check for this link. This standalone page (opened
by a LaunchAgent during install, outside the served app) has no endpoint
to check against yet. `#664`'s `resolveInstall` already carries the
`isOwnAccount` concept server-side -- Pete named it as the existing
precedent for a real fix, tracked as its own follow-up rather than
guessed at here under time pressure.

## Verification

- [x] `node --test install.installing-page.test.js` -- updated the
      existing link-wiring test for the new label, and added a new test
      pinning the "often THEIRS" sentence and the backout copy, plus
      that the old "Open Kosmos" / redirect-to-Applications copy is
      gone. 6/6 pass.
- [x] `npm test` (full suite): 0 failures, exit 0.
- [x] The refusal to auto-navigate (the actual safety property, unwaged
      by this change) still holds -- the `takenBranch` regex assertion
      for `location.replace` is unchanged and still passes.
