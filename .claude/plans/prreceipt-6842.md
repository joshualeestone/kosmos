# prreceipt-6842: a task's receipt names the pull requests the agent worked on while it held it (kosmos#6842 slice 1)

## Why
kosmos#6842 (a user, via Josh 10-21): "tokens to PR ... a dashboard to show ROI". Step 1 (on the card, 2026-10-21) found the
per-task receipt (#5153) already shows each agent's tokens and cost at API prices on the task page, so the missing piece for
"what did this result cost" is the RESULT: the PR. Claude Code writes a `pr-link` row (prRepository, prNumber, prUrl) when a
session acts on a PR, and repeats it on later turns. Measured: 238 of 448 recent transcripts on this Mac carry them. A
session's first row for a PR followed `gh pr create` 316 times, `gh pr comment` 43, `gh pr merge` once and other commands 15
(my own folder). So a row means the agent WORKED ON the PR, not that it opened it. My first measurement (one session, which
only created) was not the rule; review 1 found the comment case.

## Change
- engine/receipt.js claudeWork: read `pr-link` rows in the same pass (one parse per line). A session repeats a PR's row
  on every later turn (review 2: 30+ rows over an hour for one PR), so only each session's FIRST row for a PR marks an act
  (keyed by the row's sessionId, else its file). A PR is listed when some session's first row for it is inside a hold,
  once, ordered by that time. The repo must be owner/name and the number a positive integer; a link only when prUrl is
  exactly https://github.com/<repo>/pull/<n>. Returns `prs` (first 20) and `prsMore`.
  Residuals, accepted: (1) a session that acts on the same PR twice is counted at its first act only (under-lists).
  (2) The receipt skips transcripts last written before the first hold. If one session's rows ever spanned two files and
  the earlier file were skipped, a repeat in the later file would read as that session's first act (over-lists). Not
  seen: review 3 measured 406 transcript files with pr-link rows on this Mac, every row's sessionId equal to its file's
  name, and no subagent file holding pr-link rows. (3) Rows with no sessionId are keyed by their file; real rows all carry
  one (review 4 sampled 13,684). (4) A PR is tied to a task by TIME only, as the receipt's tokens and commands already are:
  an agent holding two tasks at once, or acting on an unrelated PR during a hold, lists that PR on this task too
  (over-lists). Slices built on this (a project's total, the Enterprise console) must not treat the PR attribution as exact.
- VERSION 3. A kept VERSION 2 receipt is kept as it was (recomputing could lose work whose transcripts were pruned, as review
  1 of #5153 found); it has no `prs`, so the page shows no pull request line for it.
- web/index.html tkReceiptPrsHtml: "Worked on pull request(s) app#12, ..." under the agent's cost line; a link only to a
  github.com pull request, opened in a new tab; null entries skipped; nothing when `prs` is absent or empty.

## Decided
"Worked on", not "opened". Rejected: detecting `gh pr create` in the command before the row (PRs are also created through
APIs and other tools, and the receipt keeps commands as a count, never their text).

Deferred (review 2): receipts already kept at VERSION 2 stay without `prs`, so tasks closed before this ships show no PR
line. Recomputing them could lose work whose transcripts were pruned (#5153 review 1); a recompute that falls back to the
kept receipt when transcripts are gone is a possible later step, noted on the card.

## Not in this slice
Codex/Gemini/Grok PRs (their logs carry no PR link); PRs on the agent page's Recent work rows (`dWorkMeta`; the receipt
carries them, the row does not show them yet); a project's total (slice 2); the Enterprise console (slice 3).

## Verify
- engine/receipt-5153.test.js: a session's first row in the hold (including a later session acting on a PR another session
  opened), a row only carried forward from before the hold not listed, repeats once, after the hold not listed, malformed
  rows, foreign URL; two sessions acting on one PR in the hold list it once; rows without a sessionId keyed by their file; at
  most 20 listed with the rest counted; v2 kept. Mutants (no session key, no hold check, keeping the last row, trusting
  prUrl, dropping the v2 keep, not merging sessions, one shared key for rows with no sessionId, no cap) each fail a test.
- web.receipt-5153.test.js: the line, the link, escaping, no link for a non-github URL, a null entry skipped, nothing for
  absent/empty. Mutant (no null guard) fails a test; the URL check was mutated before the wording change too.
- Real transcripts: claudeWork over icecreamkitty's own folder lists kosmos-relay#545 for a hold 15:00-15:30Z 10-21 (opened
  15:16:46Z), and nothing for 15:17-16:00Z although the session repeats #545's row all through it.

## Weakest premise
That `pr-link` keeps meaning "this session acted on this PR" across Claude Code versions; it is the tool's transcript
format, not a contract. If it starts firing on mere views, the line would over-list PRs; the tests pin the shape read.
