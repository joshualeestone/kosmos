# #3136 — "Check now": on-demand Claude account liveness that greens the badge

## Problem (from Josh, 2026-09-15, on 0.6.68)
All 5 signed-in Claude accounts show "Signed in · not recently checked" (the
`signed_in_unverified` badge) even though they are connected. Root cause
(diagnosed on the card): the badge only turns green (`working`) from a FRESH
(<5min) WITNESSED live-streaming scrape recorded per agent (status.js:6318).
An account with no currently-streaming agent — the normal state, and every
agent-less account — therefore stays gray forever, reading as "not connected".
This is working-as-designed-but-too-strict, not a join/recording bug (the
server.js:5868 join is correct).

## The two fixes (this card builds #1; Mona owns #2's copy)
1. **On-demand "Check now" (this build).** Let the person positively verify an
   account NOW. It fires the ONE honest liveness check that survives #874 — a
   real `claude -p` call — and feeds the outcome to the badge so a live account
   turns green on demand. This directly satisfies Josh's "show that I'm
   connected even though I am."
2. **Copy reframe (Mona's lane).** Once check-now exists, the neutral
   `signed_in_unverified` wording should stop reading as "not connected"
   (e.g. "Signed in — check to verify" instead of "not recently checked"). I
   hand Mona the exact trigger/string once the mechanism lands. NOT built here.

## Why a real `claude -p` call and nothing cheaper (#874 / #1916)
`subscription.checkLive` (OAuth accounts — Josh's case) is built on
`claude auth status`, which returns loggedIn:true for a REJECTED token (#874) —
it cannot validate. The only reliable OAuth validator is Claude Code's own auth:
a real `claude -p` call. That primitive ALREADY EXISTS as
`engine/create.js::claudeAccountLive(configDir)` (#1916, the create gate), whose
own comment says it is used only there "NEVER on the badge/poll ... separate
card" — that card is #3136. So this build EXPOSES that existing, tested probe on
demand; it does not invent a new one. API-key rows could use the cheaper
`claudeaccounts.checkLive` (GET /v1/models) but claudeAccountLive already
classifies both paths' outcomes correctly, so one path keeps it simple.

## Guardrails (carry from #874 / #1921)
- NEVER auto-green a stored sign-in. Green means a real call succeeded.
- NEVER a background/auto probe — this is USER-INITIATED only (honors #1921's
  "never a probe on the tick"; a real call spends the person's quota).
- UNKNOWN (capacity / rate / overload / network / unrunnable) FAILS OPEN — it
  records NOTHING and leaves the prior badge, never flips a live-but-capped
  account to "not connected" (the #1315/#1916 false-negative this family must
  not ship).

## Implementation
1. **engine/observed.js** — add a dir-keyed observation alongside the agent
   store (the check-now result is account-scoped, not agent-scoped):
   - `dirStore` Map keyed `provider + ' ' + resolvedDir`.
   - `sawDir(provider, dir, outcome, now)` — same provider/outcome enforcement
     as `saw`; dir must be a non-empty string. Overwrites in place.
   - `readDir(provider, dir)` → `{outcome, at}` | null.
   - `_clearForTest` clears both stores. Export sawDir/readDir.
2. **server.js** — new `POST /api/accounts/claude/check` (same localhost/board
   auth guard as the other /api/accounts POST routes):
   - body `{ dir }`; resolve the account via `accounts.list()` by resolved dir;
     404 if unknown.
   - `state = await create.claudeAccountLive(account.dir)` (subscription.STATE).
   - CONNECTED → `observed.sawDir(ANTHROPIC, account.dir, OUTCOME.OK)`;
     NONE → `sawDir(..., OUTCOME.REJECTED)`; UNKNOWN → record NOTHING.
   - respond `{ state: 'connected'|'none'|'unknown' }`.
   - **Badge join (Claude arm, ~server.js:5868):** when computing each account's
     `obs`, take the FRESHEST of the agent-derived `obsByDir.get(a.dir)` and
     `observed.readDir(ANTHROPIC, a.dir)`. Verdict fn unchanged.
3. **web/index.html** — a "Check now" button in `.acct-actions` for each Claude
   row. Click → POST /api/accounts/claude/check {dir}; show "Checking…"; on
   return re-fetch /api/accounts and re-render (single badge-truth source). On
   `unknown` show a brief honest "couldn't verify — try again".

## Tests (each red-capable, with a control that can return the dangerous answer)
- **engine/observed.test.js**: sawDir/readDir — provider isolation (an OpenAI
  dir obs is unreachable from an ANTHROPIC read), dir keying, outcome filtering
  (null/idle ignored, prior survives), freshness drives verdict via readDir.
- **route test**: POST /api/accounts/claude/check with `create.setClaudeProbe`
  injecting CONNECTED / NONE / UNKNOWN → records OK / REJECTED / nothing and
  returns the right state; unknown-account → 404. Control: UNKNOWN leaves a
  prior OK intact (does not clobber to gray).
- **join test**: a fresh dir OK greens the account badge (`working`); a fresh
  dir 401 reddens (`rejected`); no observation → `signed_in_unverified`
  (control, proving the test can show both answers).
- **browser check** (extend docs/browser-checks/render-account-badge-1921.js,
  the no-board paintAccounts stub): the "Check now" button renders on a Claude
  row; wired into tools/browser-checks.sh.

## Sequencing
0.6.68 is frozen/live; this rides 6.69/6.70. Merge-as-green. Hand Mona the copy
trigger (fix #2) once this lands.
