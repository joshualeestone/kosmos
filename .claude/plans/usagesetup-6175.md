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
  (#set-accounts-msg, role=status); a success is said there after the repaint and focus moves to the account's row.
- A test for the API-key refusal (a stored key, no sign-in: 400 and no settings.json written; mutant reds it).
- The route comment says it is narrower than creation on purpose and that a misaimed status line of ours reads as
  wired on the page, so its repoint is reachable only through the route. The browser arms wait on state, not 120 ms.

## Decided, not missed
- The default account (~/.claude) is offered too: the person presses the button, and the line says what it changes in
  their own Claude Code.
- An own status line is never replaced (ensureStatusLine refuses; the test pins the file byte for byte).

## Tests
- server.allowance-3946.test.js #6175: wired, the row stops saying not-wired, a second press changes nothing, an own
  status line refused and untouched, unknown dir 404, empty body 400. Passing (7/7 with #6108), with the API-key arm.
- docs/browser-checks/render-account-usage-6108.js #6175 arms: offer, no offer on own-statusline, refusal said once,
  success repaints. NOT RUN YET (needs a queued browser run).
