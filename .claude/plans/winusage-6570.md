# winusage-6570: Claude account usage on Windows (#6570)

**Posture:** production

## Outcome

On a Windows box, a Claude account row in Settings > AI Models shows the account's current weekly and five-hour usage,
recorded from the account's own agents, and never shows a reading from a window that has already reset as current.

## Root cause (measured on the Windows box, 10-21)

Windows agents run Claude Code headless (stream-json), so Claude Code never runs its status line, and the status line
was the only writer of `kosmos-weekly.json` / `kosmos-fivehour.json`. The row showed 1% from 10-19 while the account was
at 96%. `weeklyBlockedOf` returns null (the status line is wired), so no "last reading" note either.

## Change

1. `engine/win32streamstate.js`: `usageOfEvent(event)` reads a rate_limit_event's `unifiedWindows.five_hour` /
   `seven_day` (utilization fraction, resetsAt epoch s), falling back to the top-level `utilization` + `resetsAt` when
   `rateLimitType` names the window (`unifiedWindows` is @internal in Claude Code's schema). `publisher` takes
   `usageDir` and records each event's readings there, in its own try, after the current-process check.
   `claudeAccountDirFor(configDir)` names the account folder: the agent's CLAUDE_CONFIG_DIR, or the default
   `<home>\.claude` only when the board's own default (AGENT_WORKFORCE_HOME) is that same folder; only an existing
   absolute folder.
2. `engine/kosmos-statusline.js`: `recordReadings(dir, {weekly, fiveHour}, now, {latestWins})`, the one place the two
   files' options live (main() uses it too). `latestWins` (stream only): within a window the latest figure wins,
   unchanged is skipped, and another window is taken while its reset is ahead (a re-signed folder carries the new account's reset); the status line keeps forward-only. Measured 10-22: the default folder held 96% from its
   previous sign-in while a live turn said 3%.
3. `engine/win32supervisor.js` main(): passes `usageDir` for runner `claude` only (another runner's configDir is its
   own provider's home).
4. `engine/accountsweekly.js`: `weeklyBlockedOf` names no reason on Windows (review 1): readings come from the stream
   there, wired or not, so "will not update" and the set-up offer would be false under a live reading.
5. `web/index.html`: `acctWeeklyNow` drops a weekly reading past its reset on the page (row, move-menu figure, full
   test), and the weekly meter carries data-resets and joins the reset timer, so an open list repaints at its reset. Browser check:
   `docs/browser-checks/render-account-usage-6108.js` (lastweek row).

## Non-Claude providers on Windows (decision)

- ChatGPT (Codex sign-in): no change needed. `codexlimits.read` is not platform-gated, and on Windows `codex exec` runs
  with CODEX_HOME = the account folder and writes `sessions/.../rollout-*.jsonl` there (measured: this box's codex test
  home has three 10-19 rollouts with `rate_limits` present, null because it is an API key, which has no plan limits on
  the Mac either). A ChatGPT sign-in reading is unmeasured here: no ChatGPT sign-in on this box.
- Grok (subscription): no change. `groklimits.read` is not platform-gated; whether the Grok CLI logs its billing line to
  `<GROK_HOME>/logs/unified.jsonl` on Windows is unmeasured (no Grok sign-in on this box; `~/.grok` is empty).
- Gemini (Google subscription, Antigravity): stays Mac-only by `agyusage.supported()`'s existing reason (a signed-out
  print run on Windows can open a browser; `/usage` unmeasured there). The row carries no `limits` and draws nothing.
- Gemini API key, Grok API key, OpenAI API key: no plan limits on any platform.

## Done when

- [x] A real captured rate_limit_event fed through the real supervisor reader and publisher reads back through
      accountsweekly.weeklyOf / fiveHourOf (engine/win32usage-6570.test.js), and fails with the fix reverted.
- [x] Live on the Windows box: a real claude.exe stream-json turn on the default account, through the worktree's
      reader and publisher into a sandbox account folder, reads back weekly and five-hour.
- [x] A weekly reading past its reset is not drawn (browser check, fails with the page fix reverted).
