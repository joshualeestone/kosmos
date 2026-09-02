# #1884 — An auth-blocked agent must not read as "Idle · nothing is needed"

## The incident
A real external tester (Ben), 2026-09-02. His agent's token expired; the terminal
showed `Please run /login · API Error: 401 OAuth access token has expired.` /
`Re-authenticate to continue.` — but the board header read
`Idle · it is at rest and nothing is needed`. The worst possible label over a
blocked agent, in words that stop anyone looking. Ben never opened the terminal
pane; Josh only found it by sitting with him.

## Root cause (proven)
The reconcile layer is CORRECT: `reconcileReport` rule 3b (#886) already makes a
scraped `AUTH_FAILED` stand over an idle report with a surfaced conflict. And the
UI already renders `auth_failed` as an attention state ("Sign-in isn't working",
`attn: true`, web/index.html:10372) that speaks its remedy.

The gap is in the SCRAPER. `authFailed()` in engine/status.js only recognises the
JSON-envelope form captured for #874 (`401 {"type":"error",...}`), gated by
`AUTH_ENVELOPE = /"type":"error"/`. Current Claude Code (2.1.258) prints a
human-readable line with NO JSON, so `authFailed()` returned null, `classify()`
fell through to idle, and rule 3b never got an `AUTH_FAILED` to stand on.

Byte-exact auth messages Claude Code 2.1.258 emits (recovered from its own
strings) that the JSON path misses:
- `OAuth access token has expired. Re-authenticate to continue` (Ben's)
- `OAuth access token has been revoked.`
- `API Error: 401 Invalid API key · Please run /login`
- `OAuth token revoked · Please run /login`, `Login expired · Please run /login`

## What "done" looks like (card criteria)
1. An agent whose runner shows a 401 / expired token surfaces as attention
   (`auth_failed`), not Idle. ✓ (scraper now detects the friendly form)
2. The status names the remedy. ✓ (the evidence line carries `Please run /login`)
3. A test putting an agent in the expired state asserting the status is not
   "at rest". ✓ (three tests, incl. the scrape→reconcile-over-idle path)

## The fix (scraper only; JSON path untouched)
Add a friendly-format path to `engine/status.js`:
- `AUTH_FRIENDLY_MESSAGE` — the auth messages above.
- `AUTH_FRIENDLY_REMEDY` — Claude Code's own remedy directives
  (`Please run /login` | `Re-authenticate to continue`).
- `friendlyAuthLine(rows)` — returns the line where BOTH meet, capped.
- `authFailed()`'s early `return null` becomes `return friendlyAuthLine(rows)`,
  so the JSON detection + evidence extraction (AUTH_ENVELOPE / closedEnvelope /
  envelopeStart) is byte-for-byte unchanged and every #874/#1233/#1241 test holds.

## The discriminator, and why prose does not trip it
Co-occurrence on ONE row: an auth message AND Claude Code's own remedy directive.
This is the friendly-form analog of the JSON path's "marker AND envelope on one
row" (#1241). Prose about an auth error carries the message but not the runner's
remedy on the same line — the exact property that kept the four #1233 prose rows
out. Controls in the test assert message-without-remedy and remedy-without-message
both stay out.

## Residual, pinned (not traded)
A card/message that quotes the WHOLE friendly line verbatim (message + remedy on
one row) still reads `auth_failed` — the same accepted gap as #1233's
whole-payload paste. This card and its discussion do exactly that, so an agent
working #1884 can trip it. Accepted because it is rare, temporary, and — when the
agent is also self-reporting — surfaces as a CONFLICT (rule 3b), visible and
recoverable, not the silent false calm that stopped Ben. A missed dead token is
worse than a rare false pause; this file's oldest rule.

Also pinned: a pane narrow enough to WRAP the friendly line between its message
and remedy would split the pair and be missed (Ben's held both on one row). Add
the JSON path's wrap-join if a wrapped friendly line is ever observed.

## Weakest premise
Ben's exact bytes came from the card's transcription plus Claude Code 2.1.258's
own strings, not a live capture of his remote pane. The message/remedy strings
are byte-exact from the installed bundle; the one-line layout is from the card.
If Claude Code changes the wording, the message regex needs the new string —
which is why detection keys on the stable remedy directive as the discriminator.

## Sibling: #1885
The auth-model half (Settings must reflect the AGENT's credential per config dir,
not the account) is a separate, larger fix. This card makes the blocked state
VISIBLE; #1885 makes re-auth actually reach the agent.
