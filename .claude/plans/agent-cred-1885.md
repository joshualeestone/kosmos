# #1885 (READ half) — surface an agent's OWN config-dir credential liveness on-demand

## The incident
Ben's agent showed `401 OAuth access token has expired` in its terminal while Settings said "connected". He re-authenticated his Claude and the agent stayed 401. Mechanism (Splinter, proven via Keychain path-hash): a Claude credential is stored per config dir; Ben's login refreshed the DEFAULT entry; his agent reads a SUFFIXED config dir, so no login reached it.

## Why the surface failed him
- **Settings > Accounts** (`accounts.listLive`) is per-CONFIG-DIR and live-checks each account. But it is per-ACCOUNT, never per-AGENT: it never says which agent runs on which account. Ben saw his default account connected (correct) with nothing mapping his agent to its different, dead config dir. That missing mapping is what made the state undiagnosable — Josh had to sit next to Ben.
- **The agent detail view** shows the agent's account email/label (from the board status tick, `a.account`) but NO credential liveness.

## Scope decision (Splinter, 2026-09-02) — a SPLIT, not a hold
- ✅ **BUILD THE READ HALF NOW:** an on-demand per-agent liveness surface. Correct on EITHER branch of the open fork (OpenAI-path bug vs creation-flow bug), because the agent→account mapping + the agent's own liveness are missing regardless of what broke Ben's token.
- 🛑 **HOLD THE WRITE HALF** (targeted re-auth into the agent's config dir) until Ben's Claude-agent diagnostic lands (in flight): if a fresh CLAUDE agent also fails, it is a creation-flow bug (fix moves upstream to prepare()/create) and a re-auth button fixes nothing. Do not build auth-critical write UI on an unconfirmed premise.

## Load-bearing design constraint (belongs on the card verbatim)
The live check is a subprocess (`claude auth status --json` via `subscription.checkLive`). `subscription.js` explicitly FORBIDS it in the 5-second board tick ("the cost the five-second poll would pay forever"). **So per-agent liveness MUST be on-demand, never the tick** — the next person will otherwise wire it into the tick and the board will stall.

## The infra that already exists (this is wiring, not building)
- `engine/runningas.js runningAs(session)` → `{account, configDir, ...}` (reads the agent's live CLAUDE_CONFIG_DIR from its process env).
- `engine/subscription.js checkLive({configDir})` → `{state, plan, because, checkedLive}` for THAT dir (probed: logged-in dir → CONNECTED-shaped; empty dir → loggedIn:false). Has a `setRunner` test seam.

## Backend / UI split (this PR = backend, verified)
The frontend-screenshot rule forbids merging a UI change without a browser
screenshot, and this autonomous night-shift session has no Playwright. Ben's
URGENT visibility is already shipped: #1884 (merged) surfaces `auth_failed` on the
board from the terminal 401 scrape. #1885's UI adds PROACTIVE per-agent liveness
(before a 401 shows). So:
- **This PR ships the VERIFIED backend**: the route + engine wiring + a full
  server test (Splinter's exact spec, end-to-end). No `web/` change, so no browser
  gate and it is auto-mergeable.
- **The UI display is BUILT and held for a browser-verify session** (`claude-fe`).
  The exact diff is saved (scratchpad `1885-ui.patch`): a `#d-signin` line in the
  agent detail view, filled by an on-demand `/api/agent/:name/account-status`
  fetch, guarded by the `CURRENT.sessionName` await-guard, shown only when
  not-connected, in the app's `--danger` red. It will be a follow-up PR with a
  screenshot per the frontend rule.

## The build (READ half)
1. **Engine**: a small composition that, given a session, returns the agent's account + its config-dir liveness. Reuse `runningAs(session).configDir` → `subscription.checkLive({configDir})`. (Likely a helper in an existing module or the route; keep it thin and testable via `subscription.setRunner`.)
2. **Route**: `GET /api/agent/:name/account-status` (on-demand, matching the existing `/api/agent/:name/...` detail-fetch pattern). Returns `{ok, account:{email,label,isDefault}, state, connected, because, remedy}`. The `configDir` is DELIBERATELY omitted from the response — the UI does not need it and a filesystem path does not belong on the wire. NEVER prints the credential value. Fails soft (connected:null = UNKNOWN, never a false "connected").
3. **UI**: in the agent detail view, next to the account email/label (web/index.html ~18129), fetch this on open and show the agent's credential state + remedy ("re-authenticate this agent") when not connected. On-demand only.
4. **Test** (Splinter's spec, via the seam so it does not need a real expired cred): inject a `subscription.setRunner` that returns `loggedIn:false` for the AGENT'S dir and `loggedIn:true` for the default; assert the per-agent surface reports NOT connected while the default account reads connected. This proves the WIRING reads the AGENT'S dir (the proven dir-mismatch bug), not the default. Also a positive control (agent dir loggedIn:true → connected) and an unreachable arm (→ UNKNOWN, not a false negative).

## Weakest premise (named)
The seam-based test proves the surface reads the AGENT'S config dir, which is the proven bug (Settings answered about the wrong dir / no agent mapping). It does NOT prove that real `claude auth status` reports an EXPIRED-refresh token as loggedIn:false — that is the same open question that also affects Settings, and its end-to-end verification needs a reproduced expired credential (needs-operator; the fresh-agent diagnostic Splinter is arranging). If auth-status reports loggedIn:true for an expired token, a follow-up needs a stronger liveness signal (an authenticated API call, which subscription.js deliberately avoids) — carded separately if the diagnostic shows it.

## After this merges
Cut release 0.6.22 (Splinter's owned step): main + served are both 0.6.21, so #1880/#1884/#1885 are all unreleased and Ben cannot receive them. "Done" for the auth effort = the cut. I cut 0.6.21 today so the path is known; if spent, hand the cut to Splinter.
