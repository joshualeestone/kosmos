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
- `engine/accountsweekly.js`: weeklyOf and fiveHourOf take the NEWER of the status line's reading and the endpoint's,
  in the same `{usedPct, resetsAt, at}` shape that other computers read through /api/status. Why an account
  could not be measured (`readUsage().state`) is read by slice 2, which will add its own accessor when it uses one:
  engine.reachable.test.js rightly refuses an export nothing in the product reaches.
- `server.js`: a 10-minute sweep next to accountTick, with the same gating (liveExecutionAllowed, unref, an env seam
  for the interval), brake AGENT_WORKFORCE_USAGE_POLL_OFF=1, one account at a time, and never on a request path.

## Decided
- A second source next to the status line, not a replacement: the endpoint is not a documented API, so a change
  there leaves the status line's readings standing.
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

## Validation
- engine.reachable.test.js passes (it caught an unreached export in the first version).
- engine/usagepoll-7152.test.js, 9 tests, with an injected Keychain reader and request, no real credential and no network.
- Six mutants, each red on its own test: the default account reading its folder's entry; the token written into the
  file; no expiry check; the status line always winning; concurrent reads; no freshness limit.
- The five existing tests that read the weekly shapes (accountsweekly, win32usage-6570, server.accountsweekly-6178,
  server.sibling-status-4973, web.otheraccounts-6178): 53 tests, 0 failed.
