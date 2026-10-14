# codexlimits-6176: OpenAI (Codex) plan limits in Settings (kosmos#6176 slice 2)

Slice 2 of #6176 (the slice plan is on the card, 16:55 CDT 10-14). Slice 1 (Claude's five-hour limit) is its own
branch, fivehour-6176; the two do not depend on each other.

## Done when
- A ChatGPT sign-in (OpenAI) row in Settings > AI Models shows one meter per window Codex last reported:
  "N% of its <5-hour|weekly|N-day> limit used · resets <time> · Codex last reported it <age>".
- It warns at the weekly thresholds and never suggests a move (moving agents between accounts is Claude's, #6108).
- A window past its reset is not drawn; a sign-in with no report says "No usage reading for this sign-in yet. Codex
  reports it while an agent on it is working."; an API-key row and an older board draw nothing.
- Tests: the reader (engine), the route (server), the page (browser check), each proven able to fail.

## Source (measured, not assumed)
Codex writes its own limits into its session files: each `token_count` event in
`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` carries `rate_limits.primary` / `secondary`, each
`{used_percent, window_minutes, resets_at (epoch seconds)}`, plus `plan_type`. Measured on this computer 2026-10-14:
a prolite ChatGPT sign-in, primary 10080 minutes (weekly), secondary null. An OpenAI row's `dir` is its Codex home.

## Built
- `engine/codexlimits.js`: `read(home, now)` tries the newest three session files (newest first by name, via
  `codexsession.rollouts`), reads only the last 256 KB of each, and returns the newest report
  `{ windows: [{ usedPct, windowMinutes, resetsAt (ms) }], plan, at (ms) }` with windows past their reset dropped,
  or null. The newest report decides: an older file is never used to replace a report that is over.
- `server.js`: ChatGPT rows (`authMode === 'chatgpt'`) in `/api/accounts` gain `limits`; API-key rows carry no field.
- `web/index.html`: `acctCodexUsageHtml` (called from `acctUsageHtml` for OpenAI rows) draws the meters;
  `acctWindowName` names a window by its length.
- Tests: `engine/codexlimits-6176.test.js`, `server.codexlimits-6176.test.js`,
  `docs/browser-checks/render-account-codex-6176.js` (gated.txt, README).

## Calls
1. "Codex last reported it <age>", not "Kosmos last saw it change": the source is Codex's own report, dated by its row.
2. Windows are named by their length, so a plan with other windows still reads truthfully.
3. Only the newest three files, and only their last 256 KB: the list is read on every open of AI Models.

## Known limits
- Codex reports only while it runs. An account unused since its window reset shows "no reading yet" (this computer's
  own sign-in reads that way today: its last report, from Oct 7, reset this morning).
- `render-accounts-openai.js` needs the runner's seeded board (sb4); run alone against an unseeded board it stops in
  the Add a provider flow, before any OpenAI row exists. It is measured in the full validation, on its own board.

## Weakest premise
That `rate_limits` keeps this shape across Codex versions. A changed shape reads as no reading (validated, never a
guess), so the failure mode is a missing meter, not a wrong one.
