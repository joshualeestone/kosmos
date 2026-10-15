# codexlimits-6176: OpenAI (Codex) plan limits in Settings (kosmos#6176 slice 2)

Slice 2 of #6176 (the slice plan is on the card, 16:55 CDT 10-14). Slice 1 (Claude's five-hour limit) is its own
branch, fivehour-6176; the two do not depend on each other.

## Done when
- A ChatGPT sign-in (OpenAI) row in Settings > AI Models shows one meter per window Codex last reported:
  "N% of its <5-hour|weekly|N-day> limit used · resets <time> · Codex last reported it <age>".
- It warns at the weekly thresholds and never suggests a move (moving agents between accounts is Claude's, #6108).
- A window past its reset is not drawn; a sign-in with no report says "No current usage reading for this sign-in. Codex
  reports it while an agent on it is working."; an API-key row and an older board draw nothing.
- Tests: the reader (engine), the route (server), the page (browser check), each proven able to fail.

## Source (measured, not assumed)
Codex writes its own limits into its session files: each `token_count` event in
`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` carries `rate_limits.primary` / `secondary`, each
`{used_percent, window_minutes, resets_at (epoch seconds)}`, plus `plan_type`. Measured on this computer 2026-10-14:
a prolite ChatGPT sign-in, primary 10080 minutes (weekly), secondary null. An OpenAI row's `dir` is its Codex home.
🛑 Since #4592 a LAUNCHED agent writes its sessions into its own private Codex home (`codexruntime.forAgent`), not
the account's (status.js reads the same place). So the reader is given every home that writes for the account: the
account folder and each of its Codex agents' private homes (from `agentsByAccountWalk('codex')`; a null configDir is
the default account). My first version read only the account folder and would never have seen a Kosmos agent's report.

## Built
- `engine/codexlimits.js`: `read(home, now)` lists only the newest seven day folders, ranks their files by when they
  were last written (a long or resumed session writes into a file named for when it started), reads the last 256 KB
  of each, most recent first, until three reports are found or six files are read, and returns the report with the
  latest time of its own
  `{ windows: [{ usedPct, windowMinutes, resetsAt (ms) }], plan, at (ms) }` with windows past their reset dropped,
  or null. Among the files read (at most six, most recently written first) the latest report decides: an earlier one
  is never used to replace a report that is over. A newer report in a file outside those six is not seen; the line
  still shows its age.
- `server.js`: ChatGPT rows (`authMode === 'chatgpt'`) in `/api/accounts` gain `limits`, read across the account's
  homes (one walk per request); API-key rows carry no field. Only `limit_id` "codex" (or none) counts; a file's latest
  rate_limits row decides even with no current window.
- `web/index.html`: `acctCodexUsageHtml` (called from `acctUsageHtml` for OpenAI rows) draws the meters;
  `acctWindowName` names a window by its length.
- Tests: `engine/codexlimits-6176.test.js`, `server.codexlimits-6176.test.js`,
  `docs/browser-checks/render-account-codex-6176.js` (gated.txt, README).

## Calls
1. "Codex last reported it <age>", not "Kosmos last saw it change": the source is Codex's own report, dated by its row.
2. Windows are named by their length, so a plan with other windows still reads truthfully.
3. Bounded work: seven day folders listed, at most six files read, 256 KB each; the list is read on every open of AI
   Models.
   A session resumed after more than seven days of folders is not seen (its next new session is).

## Known limits
- Codex reports only while it runs. An account unused since its window reset shows "No current usage reading" (this computer's
  own sign-in reads that way today: its last report, from Oct 7, reset this morning).
- `render-accounts-openai.js` needs the runner's seeded board (sb4); run alone against an unseeded board it stops in
  the Add a provider flow, before any OpenAI row exists. It is measured in the full validation, on its own board.
- Agents move between accounts (#2338) but keep one private home, so a private home's reports count only when written
  after the agent's job file last changed (a move rewrites it). Where the job file's time cannot be read (no plist or
  systemd unit, e.g. Windows), the home is not filtered: that keeps the reading, without the move protection.
  Any other rewrite of the job (a rename, a model change) also hides that agent's earlier reports until Codex reports
  again: a missing meter for a while, never a wrong figure.
- Every home of an account (its folder and its agents' private ones) counts only reports written since the folder's
  current login began (`codexlimits.signedInSince`): the login (auth.json `tokens.account_id`, stored only as a hash)
  is recorded in `<data>/codex-signins.json` with the time it was first seen. A token refresh rewrites auth.json but
  keeps the login, so it hides nothing; a different login starts the clock again. First sight uses auth.json's own
  time, the latest the login can have begun, so a board that first sees a sign-in just after a refresh hides older
  reports once, until the next one. A sign-in with no account_id falls back to auth.json's time. An agent's home also
  waits for its own job's last change. (Iterations 10 and 11 deferred the refresh gap; iteration 12 raised it a third
  time, and Kosmos's own sign-in check could refresh on an idle account, so it is fixed rather than reasoned away.)
- Each home lists at most 12 files, newest day folder first and by name within a day, before ranking by write time:
  on a busy day a session from yesterday resumed today may not be listed. A long session whose last 256 KB holds no
  rate_limits row reads as no report from that file.
- The six files read are shared by all of an account's homes (its folder and every agent's private one). With several
  busy agents writing sessions that carry no report, an older report in a seventh file is not seen: a missing or older
  meter, with its age shown, never a wrong one.

## Weakest premise
That `rate_limits` keeps this shape across Codex versions. A changed shape reads as no reading (validated, never a
guess), so the failure mode is a missing meter, not a wrong one.
