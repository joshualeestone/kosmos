# usageread-7152: measure every Claude account's weekly and five-hour usage, idle ones included (kosmos#7152 slice 1)

## Why
`accountsweekly` gets an account's reading only from the status-line file, which Claude Code writes when an agent on
that account takes a turn. An account nobody is using right now has no reading, and that is exactly the spare account
a person would move agents onto. On 2026-10-25 a fleet sat 11.5 hours with one account out of its week while another,
at 0%, had no reading at all (the card's opening).

## Change
- `engine/usagepoll.js` (new): for each Claude account (accounts.list(), never listLive()), read the access token its
  agents read and GET `https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`, the endpoint
  behind Claude Code's `/usage` screen. Record `{at, state, weekly{usedPct, resetsAt s}, fiveHour}` atomically, mode
  600, in the account folder as `kosmos-usage.json`. Which credential: loginexpiry.serviceNameFor. The default account
  reads the bare entry, because Kosmos starts its agents with CLAUDE_CONFIG_DIR unset; any other account reads its own
  folder's entry. Off macOS, the folder's `.credentials.json`.
- States: `ok`, `no-credential`, `no-token`, `token-expired`, `http-<code>`, `unreachable`, `unreadable-response`. An
  expired token is never refreshed and no request is sent with it.
- Review 1: a failed read keeps the last good figures and the moment they were measured (`measuredAt`) beside its own
  state, so one refused or rate-limited read does not throw a fresh reading away. A window with usage but no reset time
  yet is still measured (resetsAt null), and accountsweekly leaves it to the status line, because the /api/status
  shape carries a reset time. A five-hour reset further out than the window can be is refused, as the status line
  refuses it. The request has a hard deadline, not only a socket timeout. The first read comes 30 s after start.
- Review 3: each window carries `changedAt`, which moves only when its figure or reset changes, and accountsweekly dates
  an endpoint reading by it. The status line's `at` means the same thing (it is written only when the figure moves),
  and the page shows it as "last saw it change". So an idle account no longer claims a fresh change every ten minutes,
  and "newer" compares like with like. weeklyBlockedOf returns null while a fresh endpoint reading exists, because
  that reading does update: "it will not update" and "Set up usage reading" would be false next to it.
- Review 4: two resets within 60 s are the same window (the endpoint's reset carries a fraction of a second that moves
  between reads: measured 14:00:00.447, then 13:59:59.569, on one account), so jitter is not a change. Within one window
  (resets within an hour) accountsweekly takes the HIGHER figure, since usage only rises, so a lagging source cannot
  win by being later. A token with under a minute left counts as expired, and a weekly reset more than 8 days out is
  not a reading.
- Review 5: the sweep does not run under node's test runner. A server a test spawns inherits NODE_TEST_CONTEXT and has live execution
  armed, so without `usagepoll.liveAllowed()` it would read the operator's real logins and write into the real account
  folders. Across windows, the endpoint reading is dated by when it was last MEASURED, since the question there is
  which reading is current. The request sends its own User-Agent.
- Review 6: the profile behind the same token (`/api/oauth/profile`) is checked against the email Kosmos lists for the
  account, and a clear mismatch records `other-account`, not a reading. So a credential holding another login (seen
  on the fleet, where the bare entry and the default folder's entry were two accounts) cannot put that login's figure
  on this account, and so cannot win the higher-figure rule with it.
  "Will not update" is cleared only while the endpoint's last read worked.
- Review 7: review 5's guard covered only node's test runner. A board a harness starts from bash (browser-checks.sh,
  the shell tests, mobile-shots.js) carries no NODE_TEST_CONTEXT, lists its sandbox `.claude` as the default account,
  and shares the real Keychain, so it would have sent the operator's real token. Two guards now: AGENT_WORKFORCE_DRY_RUN=1
  (which those harnesses set) stops the sweep, and the bare Keychain entry is read only for a default folder that IS
  the real home's `.claude` (home from the user database, not $HOME), which holds for every harness whatever it sets.
  A profile that cannot be read is now a failed read (`profile-unreadable`, last good figures kept), not a pass: one
  failed profile read would otherwise let another login's figure in. Weakest premise: if the profile endpoint fails
  often, accounts with an email go unmeasured that often; the first live sweep's log line shows how often.
- `engine/accountsweekly.js`: weeklyOf and fiveHourOf take the NEWER of the status line's reading and the endpoint's,
  in the same `{usedPct, resetsAt, at}` shape that other computers read through /api/status. Why an account
  could not be measured (`readUsage().state`) is read by slice 2, which will add its own accessor when it uses one:
  engine.reachable.test.js rightly refuses an export nothing in the product reaches.
- `server.js`: a 10-minute sweep next to accountTick, with the same gating (liveExecutionAllowed, unref, an env seam
  for the interval), brake AGENT_WORKFORCE_USAGE_POLL_OFF=1, one account at a time, and never on a request path.

## Decided
- A second source next to the status line, not a replacement: the endpoint is not a documented API, so a change
  there leaves the status line's readings standing.
- A response with a weekly window and no usable five-hour window reads `ok` with fiveHour null, whether the window
  was missing or its reset was out of range. Slice 1's only consumer is the display, and slice 2's at-risk rule reads the
  weekly figure, so the difference is not carried yet (review 2, deferred). Slice 2 adds it if it needs it.
- No `source` field in the reading object. Three tests and the cross-computer /api/status contract pin its shape.
- Ten minutes: often enough to see a week run down, rare enough to cost nothing. A reading older than 30 minutes
  (three missed polls) is not used.

## Weakest premises
- The endpoint and its beta header can change without notice. The fallback is the status line, and a failed read is a
  state, not a reading.
- The default account's credential is the bare Keychain entry only because Kosmos starts default-account agents with
  CLAUDE_CONFIG_DIR unset (loginexpiry's #2129 note). If a person's own default agents set it explicitly, the bare
  entry can be another login. Measured on the fleet: there, the bare entry was a different account from the folder's.
  Kosmos's own agents never set it for the default account, so this covers Kosmos's agents.
- Windows: the credentials-file path is reasoned, not measured on a Windows machine.
- This module's own request path (https.request, our User-Agent) was not run against the real endpoint from here: the
  real response in the next section was read with a different client. The first live sweep's log line ("measured N of
  M signed-in account(s)") is where that is confirmed, and an N of 0 with readable tokens is the sign to look.
- An idle account is the one most likely to hold an expired ACCESS token: only an agent running on it refreshes the
  token, and this module never does. So an account nobody has used for hours often reads `token-expired` and stays
  unmeasured. That is the honest answer, not a reading. Slice 2 must treat it as unknown, never as headroom (review 2).
  Measured 2026-10-25: one of six accounts on the build Mac read `token-expired`; the other five were readable.

## Measured, not reasoned (review 2 asked)
The field names and units come from a real response, read 2026-10-25 for an account whose owner's web page showed 55%.
Values and times stripped to their shape:
```
"five_hour": {"utilization": 4.0,  "resets_at": "2026-10-26T01:20:00.447680+00:00", ...}
"seven_day": {"utilization": 56.0, "resets_at": "2026-10-30T14:00:00.447704+00:00", ...}
"limits": [{"kind": "weekly_all", "percent": 56, "resets_at": "...", ...}, ...]
```
So `utilization` is a PERCENTAGE (56.0, matching the page's 55% and the response's own `percent: 56`), not a fraction.
`resets_at` is ISO 8601 with a UTC offset. The reset time matched the day and hour the page showed. Six accounts read
the same way that evening, and every readable one had a non-null `resets_at`, even at 0% (so the null-reset branch is
defensive, and is kept because its cost is one line).

## Validation
- engine.reachable.test.js passes (it caught an unreached export in the first version).
- engine/usagepoll-7152.test.js, 21 tests (counted from a run; 2 added in review 6: the identity check, and the reason coming back; 2 added in review 5: the test gate, and the cross-window rule; 3 added in review 4: reset jitter, the higher figure within a window, the expiry margin and weekly cap; 2 added in review 3: the change time, and the cleared "will not update"; 3 added in review 1: the null reset and the five-hour bound; a failed read keeping
  its figures, dated when measured; the hard deadline), with an injected Keychain reader and request, no real credential and no network.
- Six mutants, each red on its own test: the default account reading its folder's entry; the token written into the
  file; no expiry check; the status line always winning; concurrent reads; no freshness limit.
- The five existing tests that read the weekly shapes (accountsweekly, win32usage-6570, server.accountsweekly-6178,
  server.sibling-status-4973, web.otheraccounts-6178): 53 tests, 0 failed.
