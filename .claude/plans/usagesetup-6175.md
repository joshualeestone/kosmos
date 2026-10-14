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
- After review 16 (NO FINDINGS), found myself: rows now take focus from code, and the page's own #4961 note says such a
  move after a click in the Mac app can match :focus-visible and draw a stroke. My first fix turned the outline off on
  the rows AND the list and said "no keyboard signal exists in this handler"; review 17 showed both wrong (the list's
  ring belongs to Remove and Move, and DSEC_KEYBOARD is set while the click handler runs). Now: rows only, and the
  ring is keyboard-only as for sections (kbd = DSEC_KEYBOARD read at the click; kbd-landed on the landed row; cleared on
  pointerdown). Browser arms: no ring after a pointer press (armed by a weaker injected rule), a solid ring after a key
  press.
- Review 15 (built, no browser arm): a refusal that arrives while a full repaint has no row drawn leaves the status line
  ("Checking your accounts…") alone; the refusal is then said nowhere that lasts, and pressing again says it (it is
  deterministic). Not built: a per-folder map the next paint renders (more state for a case needing a paint inside the
  press). Also built: a paint that throws restores the button. (A "fallback tabindex off on blur" for the list was built and
  then removed in review 17: the list already carries tabindex=-1 in its markup, so that branch never ran.)
- Review 14 (built, no browser arm): an older press's late refusal no longer empties the status line once a newer press
  began (gen check), and the success re-claim also stands down while ACCOUNTS_UNREADABLE is set (a superseding paint
  that failed). Both need two things in flight inside one press; they are guarded by reading, not by a test.
- Review 14 nit, the Windows branch of the server test returns before the 403 and link arms: kept, the repo's pattern
  (no weekly reading is wired on Windows, so the route answers 409 there first).
- Review 12 nit, the test message "the row still says it is not set up" on `assert.equal(blockedOf(), null)`: kept. An
  assertion message describes the failure, and a non-null weeklyBlocked is exactly the row still saying it is not set up.
- Review 11 nit, the setup succeeds but the repaint cannot read the list: my first Decided note here said the error
  stood alone; review 13 showed that was FALSE (the failed paint empties the status line, so "set up" was written over
  it). Now built: paintAccounts returns false when it drew the error, and the success stands down (focus only); a
  browser arm pins it. The success is then unsaid; pressing again after the list reads answers changed:false and says it.
- Review 13 (built): a settings.json that is a link whose file is not in the account folder (or a link to nothing)
  reads 'linked-settings', not 'not-wired', so the row says why and offers no set-up the route always refuses (a link
  to a file that already carries our status line still reads as set up; server arm + control). Declined: the other
  fixed refusals of ensureStatusLine (unsafe path characters, a folder under the temp root, a missing script) still
  read 'not-wired'; each needs a broken install or an odd folder name, and the refusal says why on the row.
- Review 13 nit, focus re-claim scrolls: kept; it moves focus only when focus is LOST (on body or a removed node), so
  a scroll only follows a click on blank page inside that one second.
- Review 13 nit, rowFocusable arm message: it checks the attribute that makes the hand-back possible; the hand-back
  itself is the focusIsRow arm. Kept both.
- Review 11 (built): the route is person-only (isViaScreen, 403 otherwise), and a settings.json that resolves outside
  the account's own folder (a link shared with another account) is refused with 409 and left byte-for-byte. Weakest
  premise: a HARD link shared between two folders is not detected (realpath cannot see it); judged rare enough for hand
  setups, and the refusal is the safe direction if it is ever added.
- Review 9 nit, a second account-list refresh started during the press: the newer refresh can land after the 1 s
  re-claim and blank "Usage reading set up". Not built (the ACCT_MOVE pending-outcome pattern would be a second state
  machine for a case that needs a second refresh trigger inside the press): the row still repaints correctly without
  the offer, so only the sentence is lost, and focus is kept because rows now carry tabindex=-1 (review 9's other nit).
  Weakest premise: that nothing else triggers a refresh in that window; a future timer that refreshes the list would
  make this common, and then the pending-outcome pattern is the fix.
- Review 8 nit, exact dir match: the route finds the account by its exact resolved folder from this computer's own list.
  A symlinked or differently spelled folder gets 404, never an alias. Kept: the page always sends the listed folder, and
  matching aliases would widen what the route can write to.
- Review 8 nit, success said while a concurrent writer re-breaks the file: "Usage reading set up" reports what the route
  did to the file at that moment; the repaint shows the row's real state, and the next paint corrects a race. Not built:
  a second status ("set up, but changed since") would be a rare message with no action the person can take.
- The default account (~/.claude) is offered too: the person presses the button, and the line says what it changes in
  their own Claude Code.
- An own status line is never replaced (ensureStatusLine refuses; the test pins the file byte for byte).

## Tests
- server.allowance-3946.test.js #6175: wired, the row stops saying not-wired, a second press changes nothing, an own
  status line refused and untouched, unknown dir 404, empty body 400. Passing (7/7 with #6108), with the API-key arm.
- docs/browser-checks/render-account-usage-6108.js #6175 arms: offer, no offer on own-statusline, refusal said once,
  success repaints, re-claim limits. Queued (not yet run). Server arms include the malformed-body 400.
