---
method: challenge-loop
branch: signin-enrol-proxies-3149
diff_hash: 09789c725ece2780b6bced3b6b618b143d698d5a02f48f7bec320017034ebeae
timestamp: 2026-09-16T13:41:17Z
iterations: 11
converged: true
---

# Challenge-loop proof: signin-enrol-proxies-3149

Kosmos #3149 increment 4, engine half: in-app second-factor ENROLMENT proxies
(`signinEnrol` / `signinConfirmEnrol` in engine/remote.js; `POST /api/remote/signin-enrol`
and `signin-confirm-enrol` in server.js). Eleven blind iterations, reviewer model
alternated opus/sonnet so convergence is witnessed by more than one model. Each
iteration was a fresh blind agent that saw only the code and the security brief, never
the prior ledger. The orchestrator held the ledger and fixed findings between passes.

The central invariant under review is #874: no bearer credential (enrol-only token,
session token) may cross the HTTP boundary to the browser; tokens ride the CLI on stdin
never argv; the full phone never round-trips (only the coordinator-masked `sent_to`);
`absorbSession` fails closed on a malformed/tokenless shape.

#### Iteration 1 (opus) and Iteration 2 (sonnet)
Initial passes on the first cut. iter2 corrected three stale module-doc comments (verb
count, bearer-credential count). No BLOCKER.

#### Iteration 3 (opus)
[WARNING] engine/remote.test.js + server.test.js: three security assertions were
VACUOUS. The enrol-boundary token-strip and phone-key checks could not fail because the
enrol fixtures never carried a `token` or the full phone at that boundary. Fixed: the
totp and sms enrol fixtures now emit a session-bearing token so the allowlist strip is
actually exercised; the sms leg was added to the route test; assertions now scan the
serialized payload for the full number, not just a key. This is the "a control aimed at
an enforced boundary cannot fail" class.

#### Iteration 4 (sonnet)
[WARNING] engine/remote.js signinEnrol: no fail-closed guard when the coordinator's 200
lacked the material a kind needs, so a malformed answer showed a blank enrol screen as
success. Fixed with a MATERIAL check (not a d.stage check — the tunnel forces
stage='enrolment_started' on this verb, so a stage check is vacuous; the missing field is
the failure that can actually reach here). [CONVENTION] absorbSession doc comment named
the wrong routing functions (signinEnrol does not route through it). [CONVENTION] the
malformed-input boundary suite omitted the two new routes. All fixed; token-leak
assertions strengthened to scan for the token VALUE, not just the key.

#### Iteration 5 (opus)
[WARNING] engine/remote.js: the iteration-4 material guard used `typeof`, so an
empty-string secret/sent_to passed it and produced the blank screen it was meant to
prevent. Fixed to truthiness, matching absorbSession's !token/!challenge convention; the
fixture now emits secret:''/otpauth:'' so the empty-string path is pinned. [CONVENTION]
module header understated the page-facing surface (omitted the enrolment_started fields);
completed.

#### Iteration 6 (sonnet)
[WARNING] engine/remote.js: the guard (truthiness) and the copy (typeof) were a two-edged
surface — a truthy NON-STRING value (secret:123) passed the guard yet was dropped by the
copy, the same false success one edge over. Rather than chase edges, COLLAPSED the surface:
one `str()` predicate (a non-empty string or null) drives BOTH the guard and the copy, so
they can never disagree. [WARNING] out.kind trusted the coordinator's echo; now uses the
locally-validated kind. [CONVENTION] a stale "wizard sees a stage and nothing else"
sentence contradicted the corrected paragraph above it; fixed. Regression test added for
the truthy-non-string case.

#### Iteration 7 (opus)
[CONVENTION] engine/remote.js: the material copy was not kind-scoped though the guard is,
so a stray wrong-kind field the coordinator sent could bleed into the page (no security
impact — a totp secret is page-safe display material). Fixed by gating the copy on kind,
mirroring the guard; regression test added. Two INFORMATIONAL items (sent_to masking is
the coordinator's trust boundary by design; phone-on-argv matches convention) were
non-defects.

#### Iteration 8 (sonnet)
No BLOCKER, no regression. Documented that the phone rides argv (an accepted, not absent,
exposure — the phone is not a bearer credential) so it stops being re-raised, and added a
symmetric test proving the totp branch drops a stray sent_to (the kind-scoping is now
proven in both directions). The phone-on-argv WARNING deduplicated against iteration 7.

#### Iteration 9 (opus)
[WARNING] engine/remote.js: a phone value starting with '-' could be misread by the tunnel
CLI's own arg parser as a flag (a parser concern, distinct from shell injection which
array-form spawn already defeats). Fixed by rejecting a leading '-' (no valid phone starts
with '-', so it rejects nothing legitimate; --phone is pushed last so a misparse cannot
consume a following arg). [CONVENTION] the phone comment now separates the two argv
mechanisms cleanly. Regression test + a symmetric sms-leg token-value assertion added.

#### Iteration 10 (opus)
[WARNING] engine/remote.test.js: the fail-closed material tests only drove the totp branch;
the sms guard branch (kind==='sms' + no sent_to) was unpinned, so a future sent_to/sentTo
typo would not go red. Fixed: an sms-nomaterial fixture + test now pins both kind branches.
[WARNING] SMS send has no engine/route rate cap — DEFERRED to the coordinator layer:
anti-abuse is the coordinator's job by established convention (signinStart is "safe to
repeat"), it is not a #874 violation and not a regression; tracked as a kosmos-relay
follow-up to confirm /v1/second/enrol (sms) is rate-limited.

#### Iteration 11 (opus) — CONVERGED
Clean review: no BLOCKER, no WARNING. The #874 posture holds end to end in both
directions; the collapsed str() guard and the kind-scoped copy make the empty-string and
truthy-non-string blank-screen classes and cross-kind bleed structurally impossible, and
both are pinned by dedicated fixtures. Two [CONVENTION] notes were non-defects (undefined
keys on a non-enrol verify stage are dropped by JSON.stringify — no behavioral effect; the
"challenge held the same way" prose refers to signinSession storage and is accurate) and
one INFORMATIONAL note (frontend XSS) is out of scope — the enrol screen is increment 3b,
not in this diff. Nothing required a code change, so the loop converged.

### Final Ledger

- [BLOCKER] none across all eleven iterations.
- [WARNING] all resolved: three vacuous security assertions (iter3); missing fail-closed
  material guard (iter4); empty-string guard hole (iter5); truthy-non-string guard/copy
  asymmetry (iter6); phone flag-lookalike on argv (iter9); sms-branch fail-closed test gap
  (iter10).
- [CONVENTION] all resolved or deferred with reason: doc-comment routing/accuracy (iter4,
  iter5, iter6), kind-scoped copy (iter7), phone argv documentation (iter8, iter9), and two
  non-defect notes (iter11).
- Deferred (out of this engine-proxy diff, tracked): coordinator-side sms-enrol
  rate-limiting; frontend (increment 3b) output-escaping of coordinator strings.
- [STRENGTH] #874 enforced by engine-side allowlists at every boundary + double allowlist
  at the HTTP layer; tokens on stdin; fail-closed absorbSession; the material guard is a
  single collapsed predicate that cannot present a blank screen as success in any kind or
  value shape.

Validation: engine/remote.test.js (39 tests) and the server enrol + boundary tests pass;
the full `tools/run-tests.sh` suite is run via the validation-log helper (recorded
separately). This PR is auth-adjacent and goes to PigeonPete for review; it is NOT
self-merged.
