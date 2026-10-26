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
- Review 8: an account with no email listed is not measured (`identity-unknown`) and its token is not sent, since
  there is nothing to check the login against. The status line still covers it. Weakest premise: an account Kosmos
  lists without an email (a `.claude.json` with no `oauthAccount`) gets no endpoint reading at all. A source check now
  fails if the server's sweep stops asking `liveAllowed()` before it lists accounts.
- Review 9: one email can sign in to two organizations, each with its own weekly limit, so when the folder's
  `.claude.json` and the profile both name an organization uuid they must agree (`accounts.identityOf` now returns
  `organizationUuid`; `list()` rows are unchanged). Each good record names the email it was checked against, and a
  failed read keeps the last figures only for that same login, so a folder signed in again as someone else does not
  show the old login's usage. The review 7 comment now states the guard's true scope: a board started with the real
  home and neither NODE_TEST_CONTEXT nor DRY_RUN reads the real logins, exactly as the real board would.
- Review 10: a failed read carries the record's email forward with the figures, so consecutive failures keep them
  until they are 30 minutes old (review 9 had made a second failure in a row drop them). A profile that names no
  organization, when the folder names one, is `profile-unreadable`. A new login with the same figure is a change.
  Accepted premise, not fixed: within one window the higher figure wins, which assumes usage never falls inside a
  window. If Anthropic ever revises a figure down without moving the reset, the old higher one stays shown until
  the window ends or a later status line moves.
- Review 11: a record also names the organization it was measured in, and the kept-figures and change-time rules
  require it to match when both sides name one. A measured time in the future is not fresh.
- Review 12: a busy flag older than three poll periods is stale, so one sweep that never settled cannot stop every
  later one. Scope, stated rather than fixed: the real-home rule guards the macOS bare Keychain entry only. Off macOS
  each account reads its own folder's `.credentials.json`, so a sandboxed board reads only its sandbox's files, and a
  board started with the real home and no test signals reads the real logins on any platform, as the real board
  does. Deferred to slice 2, not fixed: the profile is asked on every read (two requests per account per 10 minutes);
  caching a checked login would halve that, and is worth it only if the first live sweeps show profile failures.
- Review 13: a test now reaches the same-figure branch of the merge (the later change is shown, from either source),
  and a record names the organization the profile answered for, falling back to the folder's.
- Review 14: on every platform no folder outside the real home is read at all (the review 12 scope gap closes for
  folders a sandbox lists elsewhere). After a refusal (401, 403 or 429) the token is not sent again for an hour,
  because it is the token Claude Code itself uses: a refused request repeated every 10 minutes must not put the
  operator's live agents at risk. A server error (5xx) or a timeout is not a refusal and does not back off.
  Weakest premise, stated: this reads an endpoint Anthropic has not documented, with the subscription token. The
  endpoint and its beta header are the ones Claude Code's own usage view reads (reasoned, not measured from its
  traffic). If Anthropic objects, a refusal backs off (review 19: but the cost may be to the account, so the reader is off by default).
- Review 15: a refused profile request (`profile-http-401/403/429`) backs off as the usage request does, and the
  hour belongs to the login that was refused, so a folder signed in again is read at once. A test now uses the real
  home lookup with a sandboxed HOME, so swapping the user database for $HOME turns it red.
- Review 16: the backoff belongs to the refused token too, identified by its expiry time (not a secret), so a token
  renewed for the same login is read at once. `other-account` backs off as well, so another login's token is sent
  once an hour, not every ten minutes. While an account waits its record's `at` moves on, so its state (why it is
  not measured) stays shown; kept figures still age out 30 minutes after they were measured, which is intended: a
  figure nobody re-measured for half an hour is not shown as current.
- Review 17: the display checks the login too. accountsweekly shows a record only for the login (and organization,
  when both name one) it was measured for, so a folder signed in again shows nothing from the old login, even in the
  minutes before the next read. The credential is read once per account per sweep, and that one read decides the
  backoff, is the token sent, and keys a refusal, so a token renewed mid-request is never the one held back.
- Review 18: the organization the display checks is parsed once per version of the account's `.claude.json` (keyed
  by size and change time; the default one is 571 KB here and the check runs on request paths). A refusal stamped
  in the future (a clock stepped back) has expired rather than holding the account back. Not taken: asking the
  profile before the usage (saves one request per other-account hour; the backoff already bounds it), and the
  integer status line beating a fractional endpoint figure by under a point within a window (a display flip
  between two sources that agree to the point, not a wrong figure).
- Review 19: OFF BY DEFAULT. A board reads the endpoint only with AGENT_WORKFORCE_USAGE_POLL=1. Decided, with the
  reason: this would send every Kosmos user's subscription token, about 288 times a day, to an endpoint Anthropic
  has not documented, from a client that names itself. If Anthropic objects, the likely cost is to the account
  itself, which no backoff undoes; review 14's "the failure is a refusal" was not established, and is withdrawn.
  An account is not something to risk on a person's behalf without their knowing, so turning it on for people is
  a product ruling, not a build call. Rejected: on by default with the backoff (the risk above), and measuring
  Claude Code's own traffic first (worth doing, but it would still not make the ruling). Nothing is lost while off:
  the status line works as before, and the fleet's own launchd reader (outside Kosmos) already measures the
  fleet's accounts. What would change this: Anthropic documenting the endpoint, or a ruling to turn it on.
  Not taken: a sweep on every board restart (bounded while off), a home path spelled differently from the user
  database (reads as no-credential, safe), the backoff lost when the folder cannot be written.
- Review 20: switched off, the board also ignores any record the reader wrote earlier, so it behaves exactly as on
  main (the status line alone), not for 30 minutes after a switch-off. A rate limit (429) is the account's, so it
  keeps its hour across a renewed token; a 401 or 403 is the token's, so a renewed token is read at once.
- Review 21: a refusal is kept in its own field (`refusedState`) and carried through sweeps that sent nothing (an
  expired token, a failed Keychain read), so they cannot erase its hour. With the brake on, earlier records are not
  shown either. Not taken: a liveAllowed check inside pollAll (the server is its only caller; the tests call it
  directly with injected credentials), and keying the backoff to the organization (errs to fewer requests).
- Review 22: THE BACKOFF IS ONE RULE NOW, rewritten rather than patched again (reviews 14 to 21 each found the next
  case). A refusal is any 4xx from either request, a profile that answers but names no login or organization, or
  another login's token; a server error or no answer is not. It holds for an hour, for the refused login, and for the
  refused token (by its expiry), except a 429, which holds across a renewed token. A clock stepped back inside the
  hour still holds; a refusal more than an hour away either way has expired. It is kept in memory as well as in the
  record (the newer wins), so an unwritable folder or unreadable record cannot erase it, and every record that is not
  a reading carries it, so a restart keeps it. The rule sits in one comment above `isRefusal` in usagepoll.js.
  Ten mutants were run against it; the one that survived (clearing the memory copy after a reading) showed that line
  did nothing observable, and it was removed. Not taken: requiring an email on a record to show it (only a build that
  never shipped could write one without), and two boards racing on one record.
- Review 23: the rule is stated by exclusion. Every answer to a request that was sent is a refusal except a reading,
  a 5xx, or no answer: so a redirect (not followed) and a reply that cannot be read as what this expects hold the
  account too. While held, the record's state is the refusal (it said `ok` when a refused token came back). A copy of
  the refusal still within its hour beats a newer copy that has expired. Two older tests had passed through the hold
  rather than the code they name (their failures were 429s); they now fail with a 5xx, and deleting the line each
  guards turns it red.
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

The profile (`/api/oauth/profile`, review 11 asked) was measured the same way, 2026-10-25 19:00 CDT, by the fleet
reader recording only the field's type, never the address: on all four accounts whose token was usable,
`account.email` was a string and `organization.uuid` was present. The other two had no usable token, so sent nothing.

## Validation
- engine.reachable.test.js passes (it caught an unreached export in the first version).
- engine/usagepoll-7152.test.js, 55 tests (counted from a run after review 23), with an injected Keychain reader and
  request, no real credential and no network. Each review's tests are named for it in the file.
- Six mutants, each red on its own test: the default account reading its folder's entry; the token written into the
  file; no expiry check; the status line always winning; concurrent reads; no freshness limit.
- The five existing tests that read the weekly shapes (accountsweekly, win32usage-6570, server.accountsweekly-6178,
  server.sibling-status-4973, web.otheraccounts-6178): 53 tests, 0 failed.
