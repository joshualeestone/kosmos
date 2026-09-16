---
branch: dialog-msg-layout-3130
---
# Plan: #3130 dialog message layout (Josh 6.68 feedback)

## Goal
Josh's 6.68 feedback on the room / consolidated message dialog (`pjRoomRow` and its
`.msg` markup, shared by the tab-view and consolidated project views):
1. Avatar vertically centered with the agent/user name.
2. Agent bubbles left, user bubbles right (Josh: "margins make it look reversed").
3. Remove the "Nothing back from <agent>" / "nothing back from any of them" messages entirely.
4. Do NOT show the agent title in the dialog.
5. Timestamp: "at 00:00 XM on Mon XX" -> "00:00 am, Mon XX" (lowercase am/pm).

## What changed (web/index.html)
1. `.msg` gains `align-items: center` so the 34px avatar centers with the compact
   bubble/name (the short agent pings that dominate this dialog). WEAKEST PREMISE: for a
   multi-line message the avatar centers on the whole bubble rather than the name line
   specifically; name-line pinning would need a markup restructure + a browser check. This
   is a reversible one-liner; Josh can nudge it in-app.
2. ALREADY BUILT by #2918 (`.msg.you { flex-direction: row-reverse }` + the body/header
   mirror). Verified the flex direction gives agent-left / user-right; no reversing margin
   found. NO code change. (If Josh still reads it reversed in-app that is a browser-verify
   follow-up, not a blind re-flip.)
3. `pjReceiptSentence`: the silence clause (`if (silent && silent.length &&
   groups.placed.length) { ... "Nothing back from ..." }`) is removed. The actionable
   delivery clauses ("could not be reached", "may have it; not confirmed") are KEPT --
   Josh removed the silence noise, not the delivery receipt. `pjRoomRow` now computes
   `receiptText` and gates the delivery pill on it, so a placed-everywhere operator post
   (empty sentence) draws NO stray empty `<span class="delivery">`.
   SCOPE DECISION (A-pure): the silence COMPUTATION plumbing (`pjSilences`, `pjSilentSince`,
   the `silent` params, `placedWho`, the now-orphaned `pjJoinOr` helper, and paintRoom's
   `const silences = pjSilences(...)` call) is left in place, now unused. Rationale: `pjOldEnoughToJudge` + `PJ_SILENCE_AFTER_MS` are
   SHARED with the DM surface (`dmOwesLine`, a different surface this card does not touch),
   so a full removal is entangled; and removing `pjSilences`/`pjSilentSince` + their large
   dedicated test suite is a clean separate cleanup. FILED AS A FOLLOW-UP rather than
   smuggled into this card. Deliberate deferral, not overlooked dead code.
4. `pjRoomRow`: the `#1703` agent-title `.msg-role` span is removed from the dialog.
   `roleLine` / `ROLE_TITLES` stay in use by the member roster (`pj-member-role`).
5. `pjWhen`: `time` gets `.toLowerCase()`; cross-day returns `time + ', ' + date`;
   same-day returns `time`; the "at 3:42 PM" example comment updated. `pjWhen` is the
   SHARED formatter, so the DM thread and agent-page bubble timestamps get the new format
   too (intentional -- one formatter, one derivation). The relative "Xm ago"/"just now"
   early-returns are unchanged. `room-clock-1895` tests `messages.roomClock` (server-side
   '00:00'), NOT `pjWhen`, so it is unaffected (verified).

## Tests / checks updated
- `web.post-receipt.test.js`: the silence-sentence assertions now assert the sentence is
  ABSENT (delivery facts kept). Green: 32/32. The `pjSilences`/`pjSilentSince`/
  `pjOldEnoughToJudge` unit tests are unchanged (the functions still exist).
- `server.test.js`: the pjWhen structural meta-guard pin `/return 'at ' + time + ' on '/`
  updated to `/return time + ', '/` (the calendar-day branch still returns a dated form,
  just reformatted). Green: 297/297.
- `docs/browser-checks/render-projects.js` (cut-time-only, not in PR CI allowlist): the
  #1703 `.msg-role` presence assertions flipped to assert the title is ABSENT despite a
  seeded profile role. Needs a real browser to run; verify with the pinned-PW harness
  before the cut, or note it for cut-time.

## Risk
- Isolated to the room dialog render + the shared timestamp formatter. Additive/removal,
  no engine change.
- web/ change -> the #1720 browser-check gate wants a browser-check or a
  Browser-check-surface trailer on the PR.
- Merge-as-green once CI (browser-checks + test) is green.
