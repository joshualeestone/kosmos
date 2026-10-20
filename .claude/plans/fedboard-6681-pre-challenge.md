---
method: challenge-loop
branch: fedboard-6681
diff_hash: 9adb6b22283386ab2f93e5b625cdb5fe982534f801db0218ab0add16c224b5d5
timestamp: 2026-10-20T09:30:19Z
subdir_audit: passed
iterations: 2
converged: true
---

# Challenge-loop proof: fedboard-6681 (kosmos#6681 slice 1: the board maps the S-11-fed refusals by code)

Two blind iterations (Opus, then Sonnet). Iteration 2 returned no BLOCKER, WARNING or CONVENTION, so it converged.

## Iteration 1 (Opus)
[WARNING] the 254 bound was never tested at its edge (254 sent, 255 refused, now in bytes)
[NIT] one code table for both routes (now keyed by route, each code maps only where it is sent)
[NIT] the bound counted UTF-16 units while the coordinator counts bytes (now bytes)
[NIT] "leave it empty" aimed at a field slice 2 adds (kept; re-checked against the real field in slice 2)
[NIT] "Withdraw some from Members" on the create path, which has none (now any project's Members, or wait)
[STRENGTH] codes, statuses and field names match the coordinator branch and remote.refusalOf

## Iteration 2 (Sonnet): converged
[NIT] the board measures the trimmed address, the coordinator the normalised one (a refusal still maps to bad-email)
[NIT] body.error carries the raw sentence (as the sentence-map path already does; the page words the reason)
[NIT] "the email address you use for Kosmos+" vs the coordinator's "the address you sign in with" (same meaning)
[STRENGTH] route-keyed table with an own-property guard; an older tunnel falls back exactly as before

Tests: engine/federation.test.js and web.federation-3312.test.js, 42 and 25 pass; five mutants (verify ignoring codes,
invite ignoring codes, the address not forwarded, a flat code table, characters for bytes) each red.
