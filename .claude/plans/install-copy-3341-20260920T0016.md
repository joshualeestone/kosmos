# Plan: #3341 - delete the "It is a large download." install-copy line

Card: joshualeestone/kosmos#3341 (Josh 0.6.83 QA, screenshot 9.01.47). Frontend/web copy.
Owner: Mona Lisa. Branch: install-copy-3341.

## What Josh asked for
Delete the line "It is a large download." from the install copy.

## What I built (web/index.html)
In `frClaudeConfirmSentence`, the KNOWN arm (`willInstall === true`, the state Josh's machine was in)
was `'In order to connect to Claude, we need to install Claude Code first. It is ' + size + '.'`
(rendered "It is a large download[, about NNN MB].") -> deleted that second sentence, leaving
`'In order to connect to Claude, we need to install Claude Code first.'`.

## Decision (night shift - decide, document, move)
- Deleted the line from the KNOWN arm only - the exact line Josh quoted, and the arm his screen
  rendered. The UNCERTAIN arm ("...if it is not here already we will install it, a large download.")
  keeps the magnitude: it is different wording Josh did not flag, and where we are unsure an install
  is even needed, a size heads-up beside the "if it is not here already" hedge is still appropriate.
  This also keeps `size`/`bytes` used (no dead code).
- Weakest premise: Josh may want the magnitude gone from the uncertain arm too. He quoted only the
  known arm's phrasing ("It is a large download."), so I scoped to that. One-line follow-up if he
  wants both.
- The confirm STEP itself is untouched (still gates the download); only the sentence changes. The
  DOWNLOADING-phase copy ("This is the one big download. Everything after it is quick.") and the
  installing-page copy are different surfaces Josh did not flag; left alone.

## Tests
- Updated web.win32-board-copy.test.js "MAC ... confirm sentences": the known-arm expected value
  dropped the "It is a large download, about 231MB." clause; the uncertain-arm expected value is
  unchanged. Renamed the test off "MAC UNCHANGED" since the known arm did change.
- web.connect-confirm.test.js (`/a large download/` present) still passes via the uncertain arm.
- web.willinstall-behaviour-1556.test.js passes (it asserts "we need to install Claude Code first"
  in the known arm, which is preserved; it does not assert the download clause).
- render-connect-skip.js asserts "we need to install Claude Code first" (preserved) - unaffected.

## Ship
- web/ change -> #1720 browser-check gate + #2518 surface gate: PR will carry the needed trailers.
- Merge is for the next build; hold the merge per night shift (Josh is pushing 6.83 now).
