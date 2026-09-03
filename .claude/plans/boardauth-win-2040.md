# Plan: boardauth-win-2040 — Windows chmod-600 is a silent no-op; the comment claims a boundary that isn't there

Card: joshualeestone/kosmos#2040

## What "finished" looks like

- `engine/boardauth.js` no longer documents an owner-only-mode boundary as if it
  held on every platform. Every site that made that claim is qualified: the
  boundary holds on POSIX and does NOT hold on Windows (the `chmodSync(0o600)`
  is a silent no-op; the token inherits its parent ACL).
- The platform truth is a real, pure, exported predicate (`ownerOnlyModeIsEnforced`)
  — the platform branch, not a comment a grep asserts on.
- A test pins the dangerous answer: on `win32` the boundary is NOT enforced.
  If anyone later flips the predicate (or the comment) to claim Windows
  protection without actually implementing an NTFS ACL, the test goes red.
- `yarn test` green on this machine.

## Decision (my call, per Josh's standing "decide it yourself" rule)

The card lists two actions and says "even if 1 is deferred, do 2":
1. Restrict the token on Windows (icacls / node equivalent).
2. Correct the false-assurance comment so it states which platforms the boundary holds on.

**I do #2 fully and defer #1.** Reasoning:

- #2 is fully verifiable on this macOS machine. #1's acceptance criterion is
  "verify by READING the resulting ACL" — that requires a Windows host, which I
  do not have. Shipping an unverified `icacls` call would be a new false
  assurance: a documented Windows protection that has never been observed to
  work. That is *this card's exact defect class*, recreated. So I will not add
  an unverified ACL call.
- The card itself names the comment (#2) the "dangerous half": a missing guard
  invites a fix; a guard documented as effective tells the next reader the
  question is settled. Fixing the documentation removes the trap.

**Weakest premise:** that the comment fix materially reduces risk. It does not
restrict the Windows token — it stops the next reader being misled and leaves a
tested, named branch for whoever implements the ACL. The Windows token stays
unprotected until #1 lands. I state that on the card and route #1 to the Windows
verification agent (needs a Windows machine).

## Changes (engine/boardauth.js)

1. Add pure predicate `ownerOnlyModeIsEnforced(platform = process.platform)` →
   `platform !== 'win32'`, with a docblock explaining the Windows no-op (#2040).
   Export it.
2. Qualify the `ensureToken` docblock (the boundary claim → POSIX-only; name the
   predicate; 🛑 Windows does not hold, #2040).
3. Qualify the self-heal comment ("only a boundary while unreadable" → POSIX only).
4. Qualify the creation-path comment ("the file mode is the real guard" → on POSIX).
5. Qualify the top-of-file docblock ("cannot read the token file" → on POSIX;
   Windows needs an ACL not yet in place, #2040).

## Test (engine.boardauth-1946.test.js — sits beside the other boardauth posture tests)

- `ownerOnlyModeIsEnforced('win32') === false` — THE DANGEROUS ANSWER (boundary
  absent on Windows).
- `ownerOnlyModeIsEnforced('darwin') === true`, `('linux') === true` — positive controls.
- default `ownerOnlyModeIsEnforced()` equals `process.platform !== 'win32'` —
  the real platform tracks the branch.

Assertion pins the platform BRANCH, not the presence of a chmod call (per acceptance).

## Not doing / deferred

- The NTFS ACL restriction (#1). Needs a Windows machine to implement and to
  verify by reading the resulting ACL. Routed to the Windows verification agent.

## Verify

- `yarn test` (full suite) green on this Mac.
- Read the diff: every previous cross-platform boundary claim now carries a
  platform qualifier (grep the file for the old unqualified phrasings).
