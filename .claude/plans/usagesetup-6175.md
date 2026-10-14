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

## Decided, not missed
- The default account (~/.claude) is offered too: the person presses the button, and the line says what it changes in
  their own Claude Code.
- An own status line is never replaced (ensureStatusLine refuses; the test pins the file byte for byte).

## Tests
- server.allowance-3946.test.js #6175: wired, the row stops saying not-wired, a second press changes nothing, an own
  status line refused and untouched, unknown dir 404, empty body 400. Passing (7/7 with #6108).
- docs/browser-checks/render-account-usage-6108.js #6175 arms: offer, no offer on own-statusline, refusal said once,
  success repaints. NOT RUN YET (needs a queued browser run).
