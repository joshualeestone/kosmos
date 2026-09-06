---
pre_challenge: true
method: challenge-loop
branch: perm-fire-1029
diff_hash: c8e3cd21dee184448b1b214bdf61ba75f68044b2d82938f1962546263bcf2d0f
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T15:57:00Z
iterations: 1
converged: true
---

## #1/#2: permission buttons fire the real macOS prompt (Josh 0.6.39)

### What ships

The fresh-install S2/S3 grant buttons now POST Kitty's native trigger
(/api/file-access-prompt, /api/a11y-prompt) to fire the real macOS prompt, instead
of opening System Settings. A helper frFirePermission(trigger, fallback, msg) fires
the trigger and, only when it is unavailable ({ok:false}/error), falls back to
opening Settings. The existing gate poll (frPollGates) detects the grant and unlocks
Next (#2, unchanged). sleep is programmatic, no trigger.

### Blind challenge-loop review

One fresh blind reviewer, told this is launch-gating and Josh-facing, traced every
branch of frFirePermission, checked the poll/gate for regression, the S3 mapping, the
disabled-state, and the tests.

**Verdict: NO BLOCKERS.**

[STRENGTH] frFirePermission is sound on every arm: {ok:true}+res.ok returns before
the fallback (no double-action); a 404/409/500 or a network throw falls through to
the fallback (no dead button); the only skip-fallback path is a confirmed success.
msg is cleared once at the top so a retry never leaves a stale error.

[STRENGTH] No poll/gate regression: the diff touches only the two click handlers;
FR_GATES, frPollGates, and the #fr-next gating are untouched. The button fires the
prompt; the poll (not the click) unlocks Next.

[STRENGTH] S3 gate->url mapping correct (tmux: trigger+fallback; sleep: fallback
only; unknown: guarded). Real buttons, disabled synchronously and cleared in finally,
so no double-fire.

[STRENGTH] Tests discriminate: section 12 asserts the trigger fires AND Settings is
NOT opened (anti-double-fire), then re-routes the trigger to {ok:false} and asserts
the fallback fires, then a 409 speaks in the pane's own message line.

[NIT] frFirePermission did not guard a null fallbackUrl: a future trigger-only gate
would fetch(null). Not reachable today (S2/S3 always pass a fallback). RESOLVED: added
`if (!fallbackUrl) return;` before the fallback fetch. No behaviour change.

[NIT] (not fixed, defensive-only) body.ok === true is strict, so a contract-violating
truthy-non-boolean ok would fall through. Kitty's contract specifies a boolean; noted,
not changed.

### Final Ledger
- BLOCKERs: 0
- NITs: 2. NIT 1 (null-fallback guard) resolved; NIT 2 (strict ok, defensive) noted.
- Converged: yes.

### Evidence
- Self-boot browser verify (5/5): S2 fires file-access-prompt and does NOT also open
  Settings; falls back on {ok:false}; S3 tmux fires a11y-prompt.
- web.firstrun-a11y-1214.test.js: 6/6. click-first-run.js section 12 updated for the
  trigger+fallback (served-board browser-check). diff em-dash swept clean.

### Weakest premise

Kitty's live trigger endpoints are not served yet, so the trigger path is verified
against mocked responses, not her real native mechanism. Her weakest premise (the
under-tmux AX attribution may need deeper native work to surface tmux) does not change
this UI: trigger + poll + flip + fallback is stable either way.
