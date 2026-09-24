# #3626: sign the board's /v1/mac/standing and /v1/mac/updating calls

Owner: Raiden. Card from Liu Kang (m429), 2026-09-24. Ships with the Josh-gated tunnel release that carries `mac-request` (kosmos-relay #103, b639b9c6).

## Finished looks like

- `engine/mac-standing.js` and `engine/updating.js` make NO direct HTTPS call to the coordinator. Each one sends its request through the tunnel binary's `mac-request` verb (`--method POST --path /v1/mac/standing|updating`, body on stdin), which signs it with the Mac key. The board still holds no key and does no crypto.
- Both stay best-effort: standing still resolves to a string or `null` and never changes the cache on failure; `announce()` still never throws, never blocks, never fails an update.
- A failure is logged once to the board's stderr (the launchd log) instead of being swallowed. "Once" means: the first failure for that route is logged, repeats of the same reason are not, and a success re-arms it.
- Tests prove each call goes out through `mac-request` with the right method, path and body, and a control goes red if either module reverts to the unsigned direct HTTPS path.

## What was measured before this plan

`POST https://login.kosmosplus.com/v1/mac/standing` with the board's exact request and no signature headers returned `401 {"error":"missing signature headers"}` at 2026-09-24T18:46:49Z. The coordinator's `verify_mac_request` reads only `x-kosmos-mac-id/ts/sig` and has no client-certificate code; the Caddy block does not request or forward one. So the TLS client cert the board presents today authenticates nothing. Full evidence: kosmos#3626 issue comment 5820153098. `/updating` was not called (it has a side effect); same guard, reasoned.

## Design

- **Transport:** `remote.macRequest(method, path, body)`, the helper from Kano's #3510, now on main (spawns the tunnel with `mac-request`, body on stdin, 20 s timeout, `{ ok, data }` / `{ ok:false, because, timedOut? }`).
- **Guards kept, in order:** the NODE_TEST_CONTEXT suite guard still runs before any `require()` (updating.js's data-root freeze reason is unchanged). Then `remote.read().on && remote.enrolled()`, exactly as today: a paid route is not called with the switch off.
- **Suite guard, re-keyed:** today it is keyed on an injected HTTP transport. The new seam is the tunnel binary itself (`AGENT_WORKFORCE_TUNNEL_BIN`, the seam remote.test.js already uses). Under the test runner the call is made only when a test has set that variable, so the suite can never run the real bundled tunnel against the paid coordinator with a sandbox key.
- **Removed:** the https/http request code, cert/key file reads, URL/prefix derivation (the tunnel owns the coordinator URL and path prefix now; `remote.COORDINATOR()` is passed as `--coordinator`), `setRequestFactory` and `dispatch` exports, and their `engine.reachable.test.js` excuse entries.
- **Timeouts:** standing was 4 s, updating 3 s, on the HTTP socket. Both callers are non-blocking (standing is single-flight upstream; announce is fire-and-forget), so the tunnel's 20 s bound is acceptable and the old short values existed only to bound a socket the board no longer holds.
- **Log once:** a small per-route latch in each module: log `kosmos#3626: <route> failed: <because>` when the reason differs from the last logged one, clear it on success.
- **updating.js header:** the "WHY THIS SPEAKS HTTP DIRECTLY" block is now false and is rewritten to say why it goes through the tunnel.

## Rejected

- Signing in node (read `mac_key`, ed25519 in the board): breaks the NO CRYPTO HERE boundary and duplicates the tunnel's signer.
- Keeping the HTTPS path as a fallback when the tunnel lacks the verb: the unsigned call always 401s, so a fallback is dead code that looks like coverage.
- A new tunnel subcommand per route: #103 already allowlists both routes in one verb.

## Weakest part of this plan

A Mac running a new board with an OLD bundled tunnel (no `mac-request`) gets `unrecognized subcommand`. Behaviour is the same as today (the call fails, the caller carries on), but it is now logged. It ships with the same release as the tunnel, so the window is only a mismatched install. What would change my mind: evidence that board and tunnel ship in separate releases, in which case the log line should name "needs an update" the way phonenotify.js does.

## Tests

- mac-standing: fake tunnel records argv + stdin; assert `mac-request --method POST --path /v1/mac/standing`, stdin `{}`, `--state-dir` = remote.stateDir(); `{"standing":"good"}` -> `'good'`; tunnel failure -> `null` + one log line; repeated same failure -> still one line; success re-arms.
- updating: same for `{"seconds":900}` and `{"seconds":0}`; never throws on tunnel missing / non-zero exit / garbage stdout.
- **Control against reverting to the unsigned path:** `https.request` and `http.request` are replaced with throwing spies for the duration; any direct dial fails the arm. Plus the fake tunnel's record must contain the call, so a module that silently does nothing is also red.
- Suite guard: with NODE_TEST_CONTEXT set and no test tunnel binary, no spawn happens (record empty).

## Coordination

Kano's #3510 owns `macRequest` + the `setupRun` timeout. Asked him (2026-09-24) to choose: wait for #3510, split the helper out first, or both carry it. **Kano chose option 1 (m436): wait for #3510**, which has converged and is in final validation; splitting would add a fresh review loop. His fixed contract: `remote.macRequest(method, routePath, body) -> Promise<{ok:true,data} | {ok:false,because,timedOut?}>`, body on stdin, 20 s default, `AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS` test seam, refuses when not enrolled. Until it merges this branch carries a same-shape stand-in in ONE separate local commit, which is dropped (rebase onto main after #3510) before the branch is pushed. The PR never carries a second copy.

**Done 2026-09-24:** #3510 merged (d6ec4601). The branch was rebased with `git rebase --onto origin/main <stand-in>`, so the stand-in is gone and `git diff origin/main -- engine/remote.js` is empty: this PR calls Kano's helper and does not touch remote.js.
