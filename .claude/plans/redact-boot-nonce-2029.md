# #2029: redact ?boot= in the install-gate log, like ?token=

## Problem

`server.js:1519` (the install-gate request log, `gateLog`) redacts `?token=` but not its
sibling `?boot=<nonce>` -- the #1979 single-use browser-open nonce, which redeems for the
same httpOnly board cookie. So a URL carrying a boot nonce reaches the log in the clear while
the durable token beside it is scrubbed. Found by Shredder (QA) in the #1760 security pass of
the shipped 0.6.25 artifact.

## Severity: genuinely low (kept honest)

- The gate log is off by default (`KOSMOS_INSTALL_GATE`).
- A nonce is single-use and expires in ~2 minutes, so a logged one is almost always spent.
- Not remotely reachable.

It is an inconsistency, not an exposure. But redacting one secret-bearing query value and not
the one beside it stops being harmless the moment the nonce's lifetime or reusability changes,
and nothing in the code recorded the omission as deliberate.

## Fix

One line: extend the redaction regex from `/([?&]token=)[^&]*/gi` to
`/([?&](?:token|boot)=)[^&]*/gi`, so `?boot=` is scrubbed exactly like `?token=`. Comment
records why (the #2029 asymmetry and the #1979 nonce it rhymes with).

Kept OUT of the #2023 outage fix deliberately (the card asked for this), as its own change.

## Test

The gate-log suite had no redaction test at all (it only checked that requests are logged).
Added one: drives `?token=`, `?boot=`, and both-together requests with distinct sentinels,
asserts neither secret VALUE reaches the log, and asserts each key survives as `REDACTED`.
Red-capable: reverting server.js to origin/main fails the boot arm (the nonce leaks) while the
token arm stays green.

## Weakest premise

That `?token=` and `?boot=` are the only secret-bearing query params the gate log can see. If a
third is ever added, this same omission recurs -- but that is a future param's problem, and the
alternation makes adding one a one-token edit.
