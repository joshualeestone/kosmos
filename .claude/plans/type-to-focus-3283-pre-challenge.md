---
pre_challenge: true
method: challenge-loop
branch: type-to-focus-3283
diff_hash: 8069309ab413dd14eb3b00cfe86fb260748221d36550a32d2f8345f9829cebb6
validation: passed
subdir_audit: passed
timestamp: 2026-09-19T14:42:52Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind review passes (plus the 6.0 initial validation baseline).
**Converged:** Yes (iteration 3 produced zero NEW actionable findings after dedup/deferral).
**Total findings:** 12 (1 BLOCKER, 3 WARNINGs, 2 CONVENTIONs, 6 NITs across all passes)
**Fixed:** 6 | **Deferred:** 6 | **Asked (awaiting user):** 0

Model variation (kosmos#2032): iteration 1 Opus, iteration 2 Sonnet, iteration 3 Opus. The Sonnet pass (iter 2) found the modal-focus-trap BLOCKER that the Opus pass (iter 1) missed - a concrete instance of why the loop varies the reviewer model.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first pass; all findings on pre-loop branch code)
- [WARNING] docs/browser-checks/render-type-to-focus-3283.js — verification was Chromium-only, but the char-retarget mechanism is engine-sensitive and the product runs WKWebView --> FIXED: added a WebKit arm (commit 51c55c47)
- [WARNING] web/index.html — space treated as printable, focusing+inserting instead of scrolling the thread --> FIXED: excluded space, kept its scroll default (51c55c47)
- [CONVENTION] .claude/plans/type-to-focus-3283.md — 5 em dashes (worker no-em-dash rule) --> FIXED: replaced with hyphens (51c55c47)
- [NIT] render-type-to-focus-3283.js — no negative arm for a no-composer surface --> FIXED: added the Agents-board arm (51c55c47)
- [NIT] render-type-to-focus-3283.js — freePort() TOCTOU --> DEFERRED: suite-wide pattern, byte-identical to render-composer-reset
- [NIT] web/index.html — e.key.length would throw if e.key undefined --> DEFERRED: cannot fire (real keydown always populates e.key; the IME keyCode guard runs first)

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 1 BLOCKER, 2 WARNINGs
**Self-generated:** 0 of the above (all on the original branch handler, not on iteration-1 fix commits)
**Duplicates of prior findings (confirmed resolved):** 0
- [BLOCKER] web/index.html — the "nothing focused == body" guard is defeated by a confirm dialog whose button disables itself on click (#rm-go, #rst-go): disabling blurs the button, activeElement reverts to body, the non-inert dialog is still up, so a keystroke during a destructive-action confirmation was stolen into #d-say --> FIXED: added a dialog-open guard (.rm-back/.fr-back backdrops), added a modal-open negative arm to the browser-check, prove-can-fail verified (commit 2e9671db)
- [WARNING] web/index.html — the modifier bail also swallowed AltGr-composed printables (@, EUR, accented letters) --> FIXED: let those through via getModifierState('AltGraph') (2e9671db)
- [WARNING] web/index.html — screen-reader browse-mode quick-nav keys could be redirected into the composer --> DEFERRED: widely-shipped pattern, AT usually consumes quick-nav before the page, no reliable JS signal to gate on; residual is a recoverable dropped/redirected key. Surfaced for Josh.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no NEW actionable findings; the CONVENTION and both NITs are non-issues, deferred with reasoning.
- [CONVENTION] .claude/plans/type-to-focus-3283.md — filename lacks a -<timestamp> suffix --> DEFERRED: the pre-challenge-gate hook requires exactly `.claude/plans/<branch>.md`; adding a timestamp would break PR creation. The reviewer confirmed the CLAUDE.md wording is the stale half.
- [NIT] web/index.html — the dialog guard does not cover non-modal nav popovers --> DEFERRED: no reachable bug (those keep focus on their toggle so the activeElement check bails; the update overlay sets siblings inert)
- [NIT] web/index.html — a visibility:hidden composer would pass rendered() --> DEFERRED: theoretical, not on any of the 3 surfaces; a drop, not a misdirect

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-type-to-focus-3283.js | BRANCH | Chromium-only verification of an engine-sensitive mechanism | FIXED | 51c55c47 (WebKit arm) |
| 2 | 1 | WARNING | web/index.html | BRANCH | Space focuses+inserts instead of scrolling | FIXED | 51c55c47 (space excluded) |
| 3 | 1 | CONVENTION | .claude/plans/type-to-focus-3283.md | BRANCH | 5 em dashes (no-em-dash rule) | FIXED | 51c55c47 |
| 4 | 1 | NIT | render-type-to-focus-3283.js | BRANCH | No no-composer negative arm | FIXED | 51c55c47 |
| 5 | 1 | NIT | render-type-to-focus-3283.js | BRANCH | freePort() TOCTOU | DEFERRED | Suite-wide pattern |
| 6 | 1 | NIT | web/index.html | BRANCH | e.key typeof guard | DEFERRED | Cannot fire |
| 7 | 2 | BLOCKER | web/index.html | BRANCH | Dialog focus trap defeated by self-disabling confirm button | FIXED | 2e9671db (dialog guard + arm) |
| 8 | 2 | WARNING | web/index.html | BRANCH | AltGr-composed printables swallowed | FIXED | 2e9671db (AltGraph pass) |
| 9 | 2 | WARNING | web/index.html | BRANCH | Screen-reader browse-mode quick-nav | DEFERRED | Surfaced for Josh |
| 10 | 3 | CONVENTION | .claude/plans/type-to-focus-3283.md | BRANCH | Filename lacks -timestamp | DEFERRED | Hook requires this exact name |
| 11 | 3 | NIT | web/index.html | BRANCH | Guard skips non-modal popovers | DEFERRED | No reachable bug |
| 12 | 3 | NIT | web/index.html | BRANCH | visibility:hidden composer passes rendered() | DEFERRED | Theoretical |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Deferred, surfaced for Josh
- **Space** keeps its scroll-the-thread default (excluded from the trigger). Reversible in one line if Josh wants space to also start a message.
- **Screen-reader browse-mode quick-nav:** a narrow AT+browser configuration could redirect a quick-nav key into the composer when nothing is focused; deferred as a deliberate call (see plan file rationale).
- **macOS Option-composed characters** without AltGraph are dropped (not misdirected) by the modifier guard; low severity.

### NITs (non-blocking, across all iterations)
- [NIT] render-type-to-focus-3283.js — freePort() TOCTOU (iteration 1)
- [NIT] web/index.html — e.key typeof defensive guard (iteration 1)
- [NIT] web/index.html — dialog guard does not cover non-modal popovers (iteration 3)
- [NIT] web/index.html — visibility:hidden composer would pass rendered() (iteration 3)

### Strengths (across all iterations)
- The keydown handler is conservatively guarded (IME, modifiers with an AltGraph pass-through, single-printable, space-excluded, nothing-focused, dialog-open) and never preventDefault/stopPropagation, so it cannot conflict with the ~20 existing Escape/Tab-only keydown handlers (iterations 1, 2, 3).
- activeComposer() resolves the one co-visible case (#pj-post vs #pj-say in Engineering mode) explicitly toward the room composer, and returns null on no-composer/disabled/unrendered surfaces so a key is ignored rather than misdirected (iterations 1, 3).
- The browser-check is non-vacuous and complete: setup controls before every land assertion, negative arms for a focused button / a no-composer surface / an open dialog, and a WebKit arm for the engine-sensitive mechanism; hermetic (sandboxed roots, fake tmux, never a live board) (iterations 1, 2, 3).
- Wiring fully reconciled across every guard a new check trips: runner for-list, README index, reason-grep EXPECTED_SITES 114->115, surface-map annotation (iterations 1, 3).
