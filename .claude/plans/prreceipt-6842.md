# prreceipt-6842: a task's receipt names the pull requests the agent opened while it held it (kosmos#6842 slice 1)

## Why
kosmos#6842 (a user, via Josh 10-21): "tokens to PR ... a dashboard to show ROI". Step 1 (on the card, 2026-10-21) found the
per-task receipt (#5153) already shows each agent's tokens and cost at API prices on the task page, so the missing piece for
"what did this result cost" is the RESULT: the PR. Claude Code writes a `pr-link` row (prRepository, prNumber, prUrl) when a
session opens a PR, and repeats it on later turns. Measured: 238 of 448 recent transcripts on this Mac carry them; one session
names only the PR it created, never ones it viewed or merged.

## Change
- engine/receipt.js claudeWork: read `pr-link` rows in the same pass; a PR belongs to the hold when its FIRST row is inside a
  hold (later repeats do not move it); repo must be owner/name, number a positive integer; a link only when prUrl is exactly
  https://github.com/<repo>/pull/<n>. Returns `prs` (first 20, oldest first) and `prsMore`.
- VERSION 3. A kept VERSION 2 receipt is kept as it was (recomputing could lose work whose transcripts were pruned, as review
  1 of #5153 found); it has no `prs`, so the page says nothing about PRs for it.
- web/index.html tkReceiptPrsHtml: "Opened pull request(s) app#12, ..." under the agent's cost line; a link only to a
  github.com pull request, opened in a new tab; nothing when `prs` is absent or empty.

## Not in this slice
Codex/Gemini/Grok PRs (their logs carry no PR link); a project's total (slice 2); the Enterprise console (slice 3).

## Verify
- engine/receipt-5153.test.js: two tests (first-row rule, repeats, outside the hold, malformed rows, foreign URL; v2 kept).
  Mutants (any-row-in-hold, trusting prUrl, dropping the v2 keep) each fail a test.
- web.receipt-5153.test.js: the line, the link, escaping, no link for a non-github URL, nothing for absent/empty. Mutant (no URL
  check) fails a test.
- Real transcripts: claudeWork over icecreamkitty's own folder with a hold 15:00-15:30Z 10-21 lists kosmos-relay#545 (opened
  15:16:46Z) beside $1.69 at API prices; a hold from 15:17Z lists none though #545's repeated rows fall inside it.

## Weakest premise
That `pr-link` keeps meaning "this session opened it" across Claude Code versions; it is the tool's transcript format, not
a contract. The first-row rule and the tests pin the shape read.
