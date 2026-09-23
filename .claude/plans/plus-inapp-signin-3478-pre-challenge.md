---
pre_challenge: true
method: challenge-loop
branch: plus-inapp-signin-3478
diff_hash: 07abea28bb1a210bb2af9404b6be99814c8bff06bda84030a88c8f281de4577b
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T16:25:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind, model-rotated: sonnet / opus / sonnet / opus)
**Converged:** Yes — iteration 4 found zero new BLOCKER/WARNING/CONVENTION findings.
**Total findings:** 16 (2 BLOCKER, 5 WARNING, 3 CONVENTION, 6 NIT)
**Fixed:** 13 | **Deferred:** 2 | **Asked (awaiting user):** 0 | **NIT (recorded, not re-iterated):** iteration-4's 2 NITs

Model coverage: both sonnet (iters 1, 3) and opus (iters 2, 4) reviewed the code, so
the convergence is witnessed by more than one model (kosmos#2032). Validation was
contention-limited during the concurrent 0.6.89 go-live (three SIGTERMs on unrelated
infra shell tests under load 8+); it completed cleanly (node fail 0, full suite in 395s)
once the cut cleared and load dropped to ~2.5, confirming the SIGTERMs were contention,
not a defect. All four headless browser scenarios pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty — these are the branch's build, not loop output)
- [BLOCKER] web/index.html — the register "done" panel was raced away by the immediate paintPlus() (engine writes enrolled synchronously) --> FIXED (4a0b8f22): removed the panel, hand off to the connected flow (mirrors plus-confirm)
- [BLOCKER] render-plus-signin-3478.js — /api/remote mock stayed unenrolled, so the "done" assertion passed WITHOUT driving the post-register repaint (false coverage) --> FIXED (4a0b8f22): flip to enrolled before register, assert the connected flow + address
- [WARNING] web/index.html — plusSiPost had no request timeout --> FIXED (4a0b8f22): 15s AbortController + "has not answered" message
- [CONVENTION] web/index.html — the signin-start "send a code" sequence was duplicated (initial + resend) --> FIXED (4a0b8f22): shared plusSiRequestCode(btn)
- [NIT] web/index.html — plusSiStage had no default branch --> FIXED (4a0b8f22): forward-guard resets to email with a message
- [NIT] render-plus-signin-3478.js — surface annotation omitted ids the check keys on --> FIXED (4a0b8f22)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** ~3 (register handler, browser check, empty-name were on iteration 1's commit; all CODE, fixed normally — not the kosmos#120 prose loop)
- [WARNING] web/index.html — clearing PLUS_SIGNIN_ACTIVE on register could drop a just-succeeded user to the marketing state if the next read was not-yet-enrolled --> FIXED (7eab96f0): leave the flag set (enrolled branch clears it) + "Signed in. Connecting..." fallback
- [WARNING] render-plus-signin-3478.js — the SMS-enrol path was never driven --> FIXED (7eab96f0): added the enrol-2fa-sms scenario (phone field -> masked sent_to lead -> confirm)
- [NIT] web/index.html — empty name skipped client validation --> FIXED (7eab96f0): client empty-name check (server requires one)
- [NIT] render-plus-signin-3478.js — only the top sign-in link was exercised --> FIXED (7eab96f0): the sms scenario enters via #plus-signin-bottom
- [NIT] web/index.html — inline margin styles vs the class idiom --> DEFERRED: matches the adjacent existing plus-enrol/plus-second markup, which uses inline styles for the same spacing

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** ~3 (cancel, plusSiEnter, register regex were on earlier loop commits; all CODE, fixed normally)
- [WARNING] web/index.html — "Not now" relied on paintPlus's untimed /api/remote read to hide the wizard --> FIXED (8918278e): hide state 2 / show state 1 synchronously, then paintPlus confirms
- [WARNING] web/index.html — wizard inputs not cleared on entry (stale code/name across cancel-restart) --> FIXED (8918278e): plusSiEnter clears inputs + resets the phone sub-field
- [CONVENTION] web/index.html — the name regex was duplicated (plus-confirm vs register) --> FIXED (8918278e): shared PLUS_NAME_RULE const
- [CONVENTION] web/index.html — first-step ids keep plus-signin-* vs the plus-si-* family --> DEFERRED: pre-existing ids from the original state-2 markup, unique/functional; the plus-signin-* family (entry links + email step) is coherent, and renaming ripples across JS refs and the committed check for a naming nit
- [NIT] render-plus-signin-3478.js — a waitForFunction resolved instantly --> FIXED (8918278e): real waitForTimeout before the navigate-away assertion
- [NIT] web/index.html — plusSiPost hardcoded "15 seconds" --> FIXED (8918278e): derive from PLUS_ASK_TIMEOUT_MS

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 blocking
**Converged** — no new actionable findings; both NITs recorded below, not re-iterated (NITs do not trigger re-iteration).

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | BRANCH | register done-panel raced by paintPlus | FIXED | 4a0b8f22 |
| 2 | 1 | BLOCKER | render-plus-signin-3478.js | BRANCH | mock unenrolled = false coverage of post-register repaint | FIXED | 4a0b8f22 |
| 3 | 1 | WARNING | web/index.html | BRANCH | plusSiPost no timeout | FIXED | 4a0b8f22 |
| 4 | 1 | CONVENTION | web/index.html | BRANCH | send-code sequence duplicated | FIXED | 4a0b8f22 |
| 5 | 1 | NIT | web/index.html | BRANCH | plusSiStage no default branch | FIXED | 4a0b8f22 |
| 6 | 1 | NIT | render-plus-signin-3478.js | BRANCH | surface annotation incomplete | FIXED | 4a0b8f22 |
| 7 | 2 | WARNING | web/index.html | SELF | register flag-clear could drop to marketing on a not-yet-enrolled read | FIXED | 7eab96f0 |
| 8 | 2 | WARNING | render-plus-signin-3478.js | SELF | SMS-enrol path untested | FIXED | 7eab96f0 |
| 9 | 2 | NIT | render-plus-signin-3478.js | BRANCH | only top sign-in link exercised | FIXED | 7eab96f0 |
| 10 | 2 | NIT | web/index.html | SELF | empty name skipped client validation | FIXED | 7eab96f0 |
| 11 | 2 | NIT | web/index.html | BRANCH | inline margin styles | DEFERRED | matches adjacent existing plus-enrol/second markup |
| 12 | 3 | WARNING | web/index.html | SELF | cancel relied on untimed paintPlus read | FIXED | 8918278e |
| 13 | 3 | WARNING | web/index.html | SELF | wizard inputs not cleared on entry | FIXED | 8918278e |
| 14 | 3 | CONVENTION | web/index.html | SELF | name regex duplicated | FIXED | 8918278e |
| 15 | 3 | CONVENTION | web/index.html | BRANCH | first-step ids not plus-si-* prefixed | DEFERRED | pre-existing unique ids; rename ripples for a naming nit |
| 16 | 3 | NIT | render-plus-signin-3478.js | SELF | waitForFunction resolved instantly | FIXED | 8918278e |
| 17 | 3 | NIT | web/index.html | SELF | hardcoded "15 seconds" | FIXED | 8918278e |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, iteration 4 — recorded, not fixed)
- [NIT] web/index.html — the name-rule error SENTENCE is duplicated across plus-confirm and the register handler (the regex is consolidated into PLUS_NAME_RULE; the message is not). Low drift risk (UI copy); a shared message const would close it. Left as a follow-up rather than re-touching the existing plus-confirm handler again post-convergence.
- [NIT] render-plus-signin-3478.js — a few `chk(true, ...)` log lines read like assertions that cannot fail; the real gate is the preceding waitForSelector({state:'visible'}) which throws on failure, so the check is non-vacuous. Cosmetic log clarity.

### Strengths (across all iterations, per the blind reviewers)
- No XSS surface: every server-supplied value (why_authenticator, sent_to, secret, address) written via textContent/.value, never innerHTML; session token + phone challenge stay engine-side (#874).
- No stuck disabled buttons: every handler re-enables on both ok and not-ok; plusSiPost has a real 15s timeout.
- Listeners attach once at load (no 5s-repaint leak); PLUS_SIGNIN_ACTIVE typeof-guarded for the new Function test harness; paintPlus only toggles top-level states, so a repaint mid-wizard does not reset the user's step.
- The register/enrolled race is handled with a documented rationale (leave the flag set so a transient not-yet-enrolled read falls back to the wizard, not marketing).
- The browser check drives all three signin-verify branches + the SMS sub-branch + cancel/re-enter, and flips /api/remote to enrolled before register so the post-register repaint is genuinely exercised; it is non-vacuous on origin/main and wired into tools/browser-checks.sh.
- The web.plus-signup.test.js pane narrowing is a faithful scope fix, not a weakening; the #2518 surface gate is satisfied with a precise named override for render-plus-gate-1615.

### Note for the PR reviewer / operator
This is a customer-facing, real-money sign-in surface. It is validated at the client
stage-machine level (headless, mocked routes) but NOT yet verified end to end against a
real Kosmos+ account + phone. The PR is opened HELD FOR LIVE VERIFICATION — do not merge
until a live sign-in has been walked through on a real account. The server-side backend
it drives (server.js signin-* proxies + engine stage machine) shipped earlier under #3149.
