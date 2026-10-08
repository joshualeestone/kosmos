---
pre_challenge: true
method: challenge-loop
branch: neverrec-5491
diff_hash: ca4e332aa89772bd74526c3932f78f7c6f4d06d2a53bcc7e559946be5b2ce3a0
validation: passed
subdir_audit: passed
timestamp: 2026-10-07T16:19:38Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: NITs only)
**Total findings:** 22 (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 18 NITs)
**Fixed:** 9 | **Deferred:** 0 | **Asked (awaiting user):** 0

Final validation (6j) on 0ffa8f2e6: the full suite, 16386 tests, 16162 pass, 0 fail, 0 cancelled (val_rc 0); subdir audit clean; both browser-check gates pass (per-check trailers for render-unread-edge-3743.js and render-agentdm-3414.js: the token is paintModelPicker's local variable `msg`). Every web.*.test.js run after iteration 3: 2522 pass, 0 fail.

Scope note (iteration 4's last NIT): the hide applies to every provider's never-recorded agent, not only Claude and OpenAI, because `neverRecorded` is set provider-agnostically (engine/status.js) and the explainer that replaces the block is shown for every provider too. Intended.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:12619 — "Changing the model restarts the agent..." still showed under a card with no model control --> FIXED (d157e053a: the line has an id, #d-model-restart-hint, hidden for a never-recorded agent by paintProviderPicker and fillSwitchAccounts, which own those lines; a hide in paintModelPicker would be undone by paintProviderPicker, which runs after it)
- [NIT] comment said "hint" for the why-note --> FIXED; test header out of date --> FIXED; no absence pin for the OpenAI sentence --> FIXED; browser check read rendered rects only --> FIXED (ties to the block's own hidden); unit pin on source text; usable's dead clause

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] docs/browser-checks/render-made-before.js:114 — Rick's `msg === ''` read through shown(), which is '' for any hidden element, so it could not fail --> FIXED (21aa18d94: reads textContent)
- [NIT] usable's dead clause; long comment line; single-entry loop shape

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [BLOCKER] web.runs-on-990.test.js:41 — it took the FIRST `go.disabled =` in paintModelPicker, which this branch made a literal `true`, so it failed (confirmed by running: 1 fail of 2522) --> FIXED (0ffa8f2e6: the test checks EVERY computed gate compares against the current model, a literal true cannot arm the button; proven red by removing the compare from the Claude gate)
- [WARNING] render-made-before.js:160 — the stopped arm read restartHint but never checked it --> FIXED (0ffa8f2e6)
- [NIT] stale comment above usable --> FIXED (now says backstop); indentation; long line; source-text pin

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [NIT] indentation in Bob's evaluate; dead backstop clauses (documented as such); the not-ours refusal unchanged; scope covers every provider (see note above)
- Searched every test that cuts text out of the four painters: none changes result.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:12619 | BRANCH | restart line under a card with no model control | FIXED | d157e053a |
| 2 | 2 | WARNING | render-made-before.js:114 | SELF | msg read could not fail | FIXED | 21aa18d94 |
| 3 | 3 | BLOCKER | web.runs-on-990.test.js:41 | BRANCH | first-match gate test broke | FIXED | 0ffa8f2e6 |
| 4 | 3 | WARNING | render-made-before.js:160 | SELF | restartHint read never checked | FIXED | 0ffa8f2e6 |

### NITs (non-blocking, across all iterations)
- [NIT] web.made-before.test.js:104 — the hide is pinned as source text; the browser check carries the behaviour (iterations 1, 3)
- [NIT] web/index.html:48355, 48528 — unreachable neverRecorded clauses, kept and documented as a backstop (iterations 1-4)
- [NIT] render-made-before.js — indentation in one evaluate object (iterations 3, 4)

### Strengths (across all iterations)
- The hide is set synchronously on every paint before any provider's path, so it always comes back for a recorded agent; OPENAI_DETAIL_GEN and the CURRENT.sessionName guard stop stale paints (iterations 1-4)
- The restart line is hidden by the two painters that own it, not fought from a third (iterations 1, 3, 4)
- The explainer keeps the reason for every never-recorded agent; it sits outside both hidden blocks (iterations 1, 2, 4)
- The browser check has a recorded-agent control and reads text and hidden state rather than rendered height; with main's page every new arm fails (iterations 2-4)
