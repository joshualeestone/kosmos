# usagesetup-6175: set up usage reading on an existing Claude account from Settings

Card: kosmos#6175 (#6108 follow-up).

## Change
- server.js: POST /api/accounts/claude/usage-reading {dir}: only a Claude account accounts.list() knows (404 otherwise),
  never an API-key account (400); runs allowance.ensureStatusLine on that account's settings.json (the same wiring as
  account creation): wired -> 200 {wired, changed}; refused (an own status line, Windows, unreadable settings) -> 409
  {wired:false, because}.
- web/index.html: a row whose weeklyBlocked is 'not-wired' shows "Set up usage reading" with one line saying what it
  adds (Kosmos's status line prints nothing but takes one empty row under the prompt in that account's Claude Code). A
  success repaints; a refusal is said on the row (a second replaces the first).

## Review 1 (opus)
- The button is described by its explainer (aria-describedby); a refusal is also written to the panel's status line
  (#set-accounts-msg, role=status); a success is said there after the repaint and focus moves to the account's row (narrowed in reviews 3 to 5).
- A test for the API-key refusal (a stored key, no sign-in: 400 and no settings.json written; mutant reds it).
- The route comment says it is narrower than creation on purpose and that a misaimed status line of ours reads as
  wired on the page, so its repoint is reachable only through the route. The browser arms wait on state, not 120 ms.

## Review 2 (sonnet)
- The explainer's id is a sequence (ACCT_SOON_SEQ), not derived from the folder (two folders could collide).
- A paint already in flight could replace the row and clear the status line after the success: the claim is re-made
  for about a second (narrowed in review 3: the message only over paint-written text, focus only when lost).
- A body that cannot be read is 400; a fault after reading is 500 with its message.

## Review 3 (opus)
- The re-claim takes back only what a paint wrote ('' or "Checking your accounts...") and stops at another writer's
  text; it moves focus only when focus is lost (falling back to the list when the row is gone).
- The page's own fallback is not lowercased; the 500 sends a plain sentence and logs the detail.
- The test stubs the API-key live check (the fixture key never reaches Anthropic), removes its folder, and covers a
  malformed body (400).

## Review 4 (sonnet)
- The first success write is guarded too (never over another writer's text; if someone spoke during the repaint,
  theirs stands and the claim stops). After a refusal, focus returns to the button when it was lost. A thrown
  ensureStatusLine is logged. Browser arms added: focus back after a refusal (pressed from the focused button), and
  another writer's sentence plus a focus the person moved both survive the re-claim second; a missing offer is a FAIL
  line, not a thrown evaluate.

## Review 5 (opus)
- Focus is still claimed (when lost) on the early return where another writer spoke; a refusal during a repaint is
  said on the button that is there now; a THROWN ensureStatusLine is 500 (a refusal it answers, including a failed
  save, stays 409); the refocus arm blurs the button inside the stubbed refusal so it can fail; a test for the 500
  (no path in the body).

## Decided, not missed
- The default account (~/.claude) is offered too: the person presses the button, and the line says what it changes in
  their own Claude Code.
- An own status line is never replaced (ensureStatusLine refuses; the test pins the file byte for byte).

## Tests
- server.allowance-3946.test.js #6175: wired, the row stops saying not-wired, a second press changes nothing, an own
  status line refused and untouched, unknown dir 404, empty body 400. Passing (7/7 with #6108), with the API-key arm.
- docs/browser-checks/render-account-usage-6108.js #6175 arms: offer, no offer on own-statusline, refusal said once,
  success repaints, re-claim limits. Queued (not yet run). Server arms include the malformed-body 400.
