---
pre_challenge: true
method: challenge-loop
branch: reauth-login-1937
diff_hash: d1e4bd965aec6ccc95bc4eb3dc6171b562ef32102f5cbad4abb90261121c0f26
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T22:41:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (fresh blind agents, no shared context)
**Converged:** Yes — round 5 surfaced no new code defect; its two premise WARNINGs were discharged by Measurement C.
**Total findings:** 4 BLOCKER/WARNING code defects fixed + 1 initial-validation fix + round-5 premise WARNINGs (deferred with measurement) + 1 NIT.
**Fixed:** 6 | **Deferred (with evidence):** 2 | **Asked:** 0

The card: the "Sign in again" re-auth launched a bare `claude` (no login argument) and every "connected" verdict was read off the local config file, which `claude auth status` reports `loggedIn:true` for even a dead/expired token (#874/#1916). So on a dead-but-present credential the press reported connected and repaired nothing. This branch makes an explicit re-auth run `claude auth login --claudeai` and gates every `finishConnected` path so a re-auth cannot finish off the stale file before the login actually completes.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER
- [BLOCKER] engine/connect.js — start()+launch fix moved the defect into the driver tick loop: on the first browser-open tick the "config-outranks-screen" guard finished off the stale-CONNECTED file and killSession()'d the running `claude auth login` (false success, login killed). --> FIXED. Introduced `owner.sawLoginDone` (latched when the CLI shows "Login successful") and gated the browser-open/awaiting-code arm on `(!owner.reauth || owner.sawLoginDone)`.

#### Iteration 2
**New findings:** 1 WARNING (test coverage)
- [WARNING] engine/connect.js — the sibling unknown-escalation arm carried the same stale-file finish but had no perturbation test. --> FIXED. Added a control arm (a re-auth on an unrecognised screen with no login-done must become STUCK, not falsely connected). Gate confirmed on that arm too.

#### Initial validation (challenge-loop 6.0)
- [BLOCKER] initial-validation: the full suite caught web.reauth-1492.test.js pinning the exact `/api/connect/start` POST body; adding `reauth:true` broke the deepEqual. --> FIXED (updated the expected body; the fresh/another arm and the installConfirmed-must-travel checks unchanged).

#### Iteration 3
**New findings:** 1 WARNING
- [WARNING] engine/connect.js — the THIRD file-outranks-screen finish (the login-done/press-enter/repl switch case) was ungated. repl/login-done are genuine login evidence, but a pre-login `press-enter` notice is NOT (the file's own comment says so), so a re-auth on a persistent pre-login press-enter finished off the stale file via settleTicks>4 with no login-done. --> FIXED. Gated the settle path on `(!owner.reauth || owner.sawLoginDone)`; repl stays unconditional. Added a pre-login press-enter control arm.

#### Iteration 4
**New findings:** 1 WARNING + 1 NIT
- [WARNING] engine/connect.js:1841 — the FOURTH `finishConnected` (runFlow's post-install gate, `!haveBinary` path) checked the stale file + expiry-blind checkLive and could finish connected BEFORE launchSignin when the binary had just been installed during a re-auth. The plan flagged this site. --> FIXED. Gated with `!haveBinary && !owner.reauth` (a re-auth always falls through to launchSignin). Added a nobinary control (same shape as the #1580 part-2 cell + reauth:true; asserts SIGNIN_LAUNCHING, not CONNECTED).
- [NIT] server.js — `reauth` computed unconditionally but consumed only on the accountDir branch. --> FIXED (added a comment noting it is intentionally scoped there; the another/default branches never receive it).

#### Iteration 5
**New findings:** 2 WARNINGs (premise) + 1 NIT --> all DEFERRED with evidence, no code change.
- [WARNING] engine/connect.js:2133 — `sawLoginDone`'s login-done latch was validated (Measurement B) only against an EMPTY config; if `claude auth login` prints "Logged in as <old>" reading a PRESENT stored identity before the new login, the latch fires early. --> DEFERRED: **Measurement C** ran `claude auth login --claudeai` against a throwaway config seeded with a PRESENT credential (browser suppressed, isolated). First screen was `Opening browser to sign in…` then `Paste code here` — IDENTICAL to the empty case, NO "Logged in as"/"Login successful" first. The latch cannot fire prematurely for a present credential.
- [WARNING] engine/connect.js:2463 — the `repl` arm is ungated for re-auth. --> DEFERRED: same Measurement C — `auth login --claudeai` goes to the browser, it never drops into the REPL, so the ungated repl arm is unreachable for a re-auth.
- [NIT] engine/connect.js:2202 — a genuine re-auth requires login-done/repl to finish (won't finish on browser-open even after the file flips); if the CLI ever completes without a recognised login-done screen the flow waits out the 15-min abandoned timeout -> becomeStuck (honest, bounded, not a hang). --> DEFERRED: documented as the plan's stated weakest premise; liveness is bounded, not a regression.

Zero NEW code findings after iteration 5's premise concerns were measured and discharged --> CONVERGED.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/connect.js tick loop | fix moved defect into tick loop; finished off stale file + killed login | FIXED | 2249804e (rebased) |
| 2 | 2 | WARNING | engine/connect.js unknown-arm | sibling arm's gate had no perturbation test | FIXED | 00ea57f7 |
| 3 | 6.0 | BLOCKER | web.reauth-1492.test.js | body-pin broke on reauth:true | FIXED | ab819877 |
| 4 | 3 | WARNING | engine/connect.js:2455 | third (login-done/press-enter/repl) arm ungated | FIXED | 190f8026 |
| 5 | 4 | WARNING | engine/connect.js:1841 | fourth (post-install) finish ungated | FIXED | f973f61e |
| 6 | 4 | NIT | server.js | reauth scoping comment | FIXED | f973f61e |
| 7 | 5 | WARNING | engine/connect.js:2133 | latch premise unmeasured for present credential | DEFERRED | Measurement C: no premature latch |
| 8 | 5 | WARNING | engine/connect.js:2463 | repl arm ungated | DEFERRED | Measurement C: auth login never REPLs |
| 9 | 5 | NIT | engine/connect.js:2202 | bounded-liveness weakest premise | DEFERRED | documented; abandoned timeout, not a hang |

### Strengths (across all iterations)
- [STRENGTH] All FOUR `finishConnected` sites reachable by a re-auth are gated (start short-circuit `&& !reauth`, post-install `!haveBinary && !owner.reauth`, and the three tick-loop arms via `(!owner.reauth || owner.sawLoginDone)`). Verified by enumeration: no fifth "reports connected" path.
- [STRENGTH] Non-reauth is provably byte-identical: every gate short-circuits `true`/`&& !reauth` for non-reauth, and the one unconditional new line (`if (login-done) owner.sawLoginDone = true`) writes a field read only inside reauth-gated conditions. The #1560/#1580/#1922 guards and the first-run/add-another launch are untouched.
- [STRENGTH] Tests are non-vacuous with real controls: each arm drives `subscription.setRunner` to make the CONNECTED short-circuit actually live (an `if(false)` bypass is caught), controls pin the flag as the discriminant, the END-TO-END arm drives the real tick loop then flips to login-done, and every fix arm was perturb-verified (reverting the fix reds the arm on the real defect).
- [STRENGTH] Server threading is safe: `reauth` is a strict-boolean 400-on-mangled, threaded only into the accountDir branch which sits AFTER the #2420 api-key-account guard, so it cannot bypass account-key billing protection, install-confirm, or leak into the new-account flows.

### NITs (non-blocking)
- server.js reauth scoping (iter 4) — addressed.
- bounded-liveness weakest premise (iter 5) — documented.
