# Plan: Account badge from OBSERVED liveness, not a stored login (kosmos#1921)

Branch: `badge-observed-1921` · Repo: joshualeestone/kosmos · Split from #1916 (create-gate half shipped).

## What "done" looks like (from the card)
The Settings account badge must render from the LAST OBSERVED OUTCOME of a real call, not from `claude auth status` (which returns `loggedIn:true` even for a token being rejected 401 — Ben's false green). States:
- observed working recently → green, "Signed in, active Nm ago"
- observed a 401 → not connected, say so + remedy
- never observed / stale → NOT green ("Signed in on this computer, not recently checked")
- a crashed check → "could not check"
- an explicit probe ("Check now") is permitted (user chose to spend the call) — DEFERRED, see Non-goals.

## Key facts established (exploration + direct reads)
1. Badge today: `GET /api/accounts` → `accounts.listLive()`/`listLiveNow()` (engine/accounts.js:279) → per-row `subscription.checkLive()` (`claude auth status`, tri-state CONNECTED/NONE/UNKNOWN) → rendered in `web/index.html paintAccounts()` badge ternary (index.html:13860-13862). By design (index.html:13848-13858, #874) checkLive CANNOT see 401 rejection — it only proves a credential EXISTS.
2. The observed 401 signal (#1884) is NOT a store. It is a transient scrape result in `engine/status.js classify()` → `STATE.AUTH_FAILED` (status.js:250, 2287), produced per pane every `snapshot()` (status.js:4240). Keyed by agent/pane name, not persisted, not per-account-dir.
3. Background cadence: the only reliably-running background caller of `snapshot()` is the 60s nudge sweep (`messages.sweepUnanswered(safeRoster())`, server.js:8103). autohandoff/heartbeat sweeps are OFF by default. So observations accrue at ~60s granularity — "checked 1-2m ago" is the natural resolution.
4. `snapshot()` already has a name-keyed side-effect precedent at the observation point: `wouldping.saw(pane.name, status.state, …)` (status.js:4263), and an identity gate one line above: only `isNamedOurs(pane)` may read/attribute that name's record (status.js:4246-4250).
5. Agent→account mapping already exists and must NOT be re-derived (codebase's worst-habit warning, server.js:718): `accountForAgent(name, known)` (server.js:697) via `create.readJob(name).configDir`, default-account = falsy configDir.
6. Default row join subtlety: default account's `row.dir` is `<HOME>/.claude` but its config lives at the sibling `<HOME>/.claude.json`; `accountForAgent` maps a falsy `configDir` to the default row. Mirror that exactly.

## Design
### Precedence (what the badge shows), computed by ONE pure function
Take the FRESHEST observation for the account (the card's "last observed outcome + when"):
1. fresh observed **401** → `rejected` (WINS over checkLive CONNECTED — this is the Ben case)
2. fresh observed **ok** → `working` ("Signed in, active Nm ago")
3. no fresh observation, checkLive **CONNECTED** → `signed_in_unverified` (login exists, not recently verified; NOT green)
4. no fresh observation, checkLive **NONE** (loggedIn:false) → `signed_out` ("Not signed in")
5. no fresh observation, checkLive **UNKNOWN/threw** → `unchecked` ("Could not check")

Freshness gates BOTH positive and negative: a stale 401 does NOT keep asserting "not connected" (the person may have re-authed) — it falls back to checkLive. This honors the repeated invariant (server.js:3378): a stale/blind signal must never manufacture a confident connected/not-connected.

Observation outcomes recorded — ONLY strong evidence, never overwrite with a weak state:
- `STATE.WORKING` → `ok` (an actively streaming turn IS a successful call in flight — direct evidence the token works now)
- `STATE.AUTH_FAILED` → `401`
- IDLE / NEEDS_YOU / anything else → record NOTHING (idle is not evidence of a working call; overwriting would re-introduce a false green)

Store: in-memory (module-level Map), keyed by agent name, `{outcome, at}`. In-memory is correct here: observation + badge render are the SAME Node process; on restart nothing has been observed yet, so "not recently checked" is the honest default. No disk-write storm in the tick.

`FRESH_MS` default 5 min (env seam `AGENT_WORKFORCE_OBSERVED_FRESH_MS`). Background sweep is 60s so a working account refreshes well inside the window; 5 min is a comfortable "recently" without asserting green on genuinely stale data.

## Reconciliation with #1930 (authprobe — landed ~1h before this branch)
`engine/authprobe.js` is a per-account (config-dir-keyed) cache of `claude auth status`, used to SUPPRESS a scraped 401 as stale scrollback (status.js:4423, reconcileReport rule 3b). It is NOT a source my badge can read for the positive signal: its checker is `subscription.checkLive`, so `HEALTHY` == "a credential exists" == the exact false-green #874 documents and this card kills. So `observed.js` (scraped WORKING/AUTH_FAILED, per-account) is genuinely new information and earns its place; `authprobe` overlaps only on the credential-exists/absent fallback, which the badge already gets from `a.connection.state`.

DECISION — record from `status.state` (POST-reconcile), not `scrapedStatus.state`:
- Recording post-reconcile inherits #1930's stale-scrollback suppression, so a repaired account's old on-screen 401 does NOT produce a false "not connected" (accounts.js:297: telling a paying customer they are disconnected is a failure to prevent).
- Its only downside is that if #1930 wrongly suppresses a GENUINE 401 (see open question), my badge misses the proactive "rejected" — but it then falls to `signed_in_unverified`, which is still NOT a false green. The card's overriding priority is killing the false green; this respects it while never introducing a false negative.

OPEN QUESTION (do NOT fix here; raise after PR): #1930 uses `auth status`==HEALTHY to decide a scraped 401 is stale, but #874/#1916 established `auth status` stays loggedIn:true for a rejected/expired token — so authprobe HEALTHY may wrongly suppress a REAL ongoing 401, a false-calm on the very surface built to avoid false-calm. Needs a measurement before filing; note to Splinter.

## Files to touch
1. **engine/observed.js (NEW)** — in-memory store + pure verdict:
   - `saw(agent, state, now)`: records `ok`/`401` per the rules above (freshens `at`); other states no-op.
   - `all()` → `[{agent, outcome, at}]`; `read(agent)`; `_clearForTest()`.
   - `verdict({checkLiveState, observedOutcome, observedAt, now, freshMs})` → `{badge, observedAt, ageMs}`. Pure, no deps → no require cycle.
2. **engine/status.js** — at status.js:4263 (beside `wouldping.saw`), add `try { if (isNamedOurs(pane)) observed.saw(pane.name, status.state, Date.now()); } catch {}`. Top-level `require('./observed')` (observed has no deps). Gated on `isNamedOurs` so only a pane genuinely tied to its name attributes an outcome to that name's account (impostor discipline).
3. **server.js** `/api/accounts` route (server.js:3383) — after `accounts.listLive()`, overlay the Claude rows: `known = accounts.list()`; for each observed agent resolve dir via the EXISTING `accountForAgent(agent, known)` (no re-derivation); group freshest observation per dir (default row via falsy configDir, mirroring accountForAgent); set each row's `connection.badge`/`observedAt`/`observedAgeMs` from `observed.verdict(...)`. OpenAI rows untouched.
4. **web/index.html** `paintAccounts()` (index.html:13860-13862) — rewrite the badge to key on `connection.badge`:
   - `working` → `.acct-connected` (green dot) "Signed in" + "· active {age}"
   - `rejected` → `.acct-none` (or new `.acct-rejected`) "Not connected" + because/remedy
   - `signed_in_unverified` → neutral class (no green pulse) "Signed in" + "· not recently checked"
   - `signed_out` → `.acct-none` + because
   - `unchecked` → `.acct-unknown` + because
   Keep title hedges. Reuse an existing relative-time helper for "{age}" if present; else a tiny local formatter.
   Back-compat: if `connection.badge` is absent (older payload), fall back to the current `connection.state` ternary.

## Tests (model the bytes the matcher sees; assert PRESENCE before absence)
- **engine/observed.test.js** — `saw` records ok only on WORKING, 401 only on AUTH_FAILED, no-ops on IDLE/NEEDS_YOU (prove a prior ok SURVIVES an idle tick); freshens `at`. `verdict` truth table for all 5 badges incl.: fresh-401 beats checkLive CONNECTED (Ben); fresh-ok beats a crashed probe (observed rescues UNKNOWN); stale-401 falls back (NOT rejected); stale-ok → unverified; NONE → signed_out.
- **server.badge-observed-1921.test.js** — drive `/api/accounts` with seeded `observed` + stubbed `checkLive`/`readJob`: an account whose agent 401'd shows `rejected` while checkLive says connected; an account with no observation + checkLive connected shows `signed_in_unverified`; default-dir agent joins to the default row.
- **engine/status observation test** — a WORKING named-ours pane records `ok`; an AUTH_FAILED named-ours pane records `401`; an impostor (not named-ours) pane records NOTHING; an idle pane does not clobber a prior ok. Use the classify/capture seams.
- **web.badge-observed-1921.test.js** — `paintAccounts` given each `connection.badge` emits the right class + string (incl. the "active {age}" / "not recently checked" text), and the absent-badge back-compat path still renders the legacy ternary.

## Non-goals (explicit, to keep the truth-fix focused)
- "Check now" active per-account probe (reusing #1916's real reachability probe + a consent-to-spend). Permitted by the card but optional; deferred to a follow-up so the truth-fix stays reviewable. Note to Splinter + file if wanted.
- The other `listLive()` callers (paintConnLive, paintAccountPicker, frPaintOpenai) and the per-agent `/api/agent/:name/account-status` route (#1885). Same store + verdict make these a cheap follow-up; the card names the Settings badge, so this PR scopes there. Revisit if a stale green is visible on those surfaces.

## Verify
`bash tools/run-tests.sh` green (engine needs node ≥ 26). Frontend: capture Settings > Accounts locally showing the four states (screenshot for PR + Discord, per house rule). Challenge-loop to convergence before PR.
