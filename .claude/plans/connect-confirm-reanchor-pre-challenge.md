---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: connect-confirm-reanchor
diff_hash: 5bff79cb25e42b091c18a8af1d8b78d390ff21164cf78290c55377df06756aca
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T16:26:00Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

Test-only fix, explicit_override, urgent: origin/main is red (this test fails on a clean
main checkout, confirmed 7/8), blocking every rebased PR incl the 0.6.39 launch fixes.
Splinter routed it to me (Angel stood down) with the root cause and the target anchor.

### What ships
web.connect-confirm.test.js re-anchored. Old: CODE.indexOf(the fr-llm-connect
getElementById) + slice(at, at+600). #2340 added a second same-id lookup (the click
handler) before the paint block, so indexOf grabbed the wrong block and the toggle sat
past the 600 window. New: anchor on `const done = sub.state === 'connected'` (the paint
block that computes the state and toggles is-connected), a small slice, same exact
assertion. Structural, not a widen.

### Self-review
[STRENGTH] Not a widen: bound to the paint block that owns BOTH `done` and the toggle, so
an insert elsewhere cannot break it and the assertion stays tied to the same `done` the
label uses. [STRENGTH] Still bites: the matched pattern is the exact classList.toggle(
'is-connected', done); a change to a different var still fails. [STRENGTH] No product
change - test file only, so it cannot regress behaviour. No issues found.

### Evidence
8/8 pass with the fix; 7/8 (this test) on clean origin/main before it. diff em-dash clean.

### Weakest premise
`const done = sub.state === 'connected'` is assumed unique to the paint block; it is
(the click handler computes no such const). If a future block reused that exact line the
anchor could drift, but that is a far narrower surface than the old any-connectBtn match.
