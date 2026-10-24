# Correct the deviceDeny docstring in engine/remote.js (Related to kosmos#6704)

## Problem

`engine/remote.js` `deviceDeny`'s docstring (`:2288-2289`) says it "Writes nothing on
this Mac". That is stale: on a real refusal (not a mere code-check drop), the function
records a small local note in `remote.json` (the `denied` map, bounded to the newest 50)
that words a later re-ask AND keeps the device out of the automatic browser-vouch allow
(`:2298-2302` write; `:1986` and `:2084` vouch consumers; the device can still be Allowed
by hand). The comment misleads the next reader of security-sensitive device-trust code.
Found during the #6704 research.

## Fix

Comment-only. Replace the stale two-line docstring with an accurate one that states the
conditional local `denied`-note write, that it is not a block, and that a fresh sign-in
may ask again. No behaviour change.

## Scope / non-goals

- Only the docstring above `deviceDeny`. No code change, no change to `deviceDeny`'s
  behaviour or to any other comment.
- Does NOT Address #6704 (that card waits on Josh's A/B/C ruling and must not be marked
  ready-to-test by this PR); the PR body says "Related to #6704".

## Done-when

1. The `deviceDeny` docstring matches the code (names the conditional `denied`-note write,
   says it is not a block).
2. `engine/remote.js` parses (`node -c`) and `engine/remote.test.js` stays green.
3. The diff is the comment only.

## Reviewer

Raiden (plain text in the PR body; `joshualeestone` is the push identity / PR author and
cannot be a GitHub reviewer). Pre-approved by Liu Kang; challenge loop scoped to one pass
for a comment-only change.
