# kosmos#1968 -- tighten POST /api/report and /api/reply against a cross-account loopback caller

## The defect (verbatim scope from the card + confirmed in code)
`#1946` (merged as PR #1972, 6e77535) token-gates the board's sensitive surface so another
macOS account on the same Mac cannot reach it. Two routes are deliberately exempt from the
board token -- `POST /api/report` and `/api/reply` (`REMOTE_AGENT_ROUTES` in server.js) -- because
a REMOTE agent reaches them with an agent token that `remoteWriteGuard` validates.

The residual: the agent-token check is mandatory only for a REMOTE peer. A LOOPBACK caller
reaches report/reply exempt from the board token, and `resolveAgentSender` falls back to a
`from_pane` sender when no token is presented (server.js:404-405). So a second local account can
POST a spoofed report/reply (and fire a `notify.happened` push to the victim) with NO credential.
NOT code execution (that surface is gated by #1946); this is spoofing a status report / message.

The reply handler's own comment (server.js:5379-5384) states the rule: "a pane name is guessable,
so retiring the fallback on /api/report alone would have left this route forging-capable. The pane
path has to leave BOTH or neither." So report and reply are tightened together.

## What "done" looks like
On an ENFORCING board (`boardAuthState.on` -- i.e. NOT a fully-sandboxed fixture),
`POST /api/report` / `/api/reply` from a LOOPBACK caller require the board token OR a valid agent
token, with the `from_pane`-only (no-credential) fallback DROPPED. On a NON-enforcing board
(fully-sandboxed test/browser-check fixture, or any board with no token) behavior is UNCHANGED --
the pane fallback works exactly as before, so zero test/browser-check churn by construction.

## Blast radius -- every same-account caller (each must present a credential or it breaks)
Swept the whole tree for POST callers of /api/report|/api/reply (non-test): exactly three, none
in the native app.
1. **`install/kosmos` `cmd_reply`** (line 581) -- sends only `from_pane`. No token at all.
2. **`install/kosmos` `cmd_report`** (line 798) -- sends agent token (`_tok`, usually empty) + `from_pane`.
3. **`bin/codex-report-bridge.js`** (line 94) -- direct fetch to /api/report; `from_pane` + optional
   agent token (usually empty). This is the Codex self-report / Stop-hook-analogue path.

`kosmos msg` / `post` / `whoami` ALREADY send `x-kosmos-board-token` via the existing `board_token()`
helper -- report/reply/bridge were simply never updated. `engine/selfreport.js` is a file-append
library, not an HTTP caller (no fix needed).

## The change

### Server -- server.js
1. `resolveAgentSender(req, body, roster)` → add a 4th param `opts`. In the no-token branch, before
   the from_pane fallback:
   ```js
   if (!presented) {
     if (opts && opts.denyPaneFallback) return { ok: false, because: opts.denyBecause || <default> };
     return messages.resolveSender(body && body.from_pane, roster);
   }
   ```
   The agent-token arm is untouched: a presented (header or `body.token`) token still DECIDES.
   Chosen over enforcing at the dispatch gate because only `resolveAgentSender` sees `body.token`
   (the dispatch runs before the body is parsed) and owns the pane fallback. A 4th *parameter* (not
   a free variable) keeps the `new Function`-extraction test in `server.paneless-sender.test.js`
   green -- 3-arg calls leave `opts` undefined ⇒ fallback works as before.
2. At the report (5286) and reply (5384) call sites, compute and pass:
   ```js
   const denyPaneFallback = boardAuthState.on
     && !boardauth.tokenOk({ token: boardAuthState.token, req, routingBase: ROUTING_BASE });
   const sender = resolveAgentSender(req, body, roster, { denyPaneFallback, denyBecause: <sentence> });
   ```
   `boardAuthState`, `boardauth`, `ROUTING_BASE` are all module-scoped and in scope here.
   - agent token presented ⇒ agent path (denyPaneFallback never consulted).
   - no agent token, valid board token ⇒ denyPaneFallback=false ⇒ pane fallback (same-account owner).
   - no agent token, no board token, enforcing ⇒ denyPaneFallback=true ⇒ refused (the fix).
   - non-enforcing board ⇒ denyPaneFallback=false ⇒ unchanged.

### CLI -- install/kosmos
3. `cmd_reply`: add `local _bt; _bt="$(board_token)"` and `${_bt:+-H "x-kosmos-board-token: $_bt"}`
   to the curl (mirrors `cmd_msg`/`cmd_post`).
4. `cmd_report`: same.

### Bridge -- bin/codex-report-bridge.js
5. Read the board token via `require('../engine/boardauth').readToken()` (single source of truth,
   no path-formula duplication), guarded so a failure can never break the agent (the file's cardinal
   rule). Add `x-kosmos-board-token` header when a non-empty token is read.

## Tests (the control must return the dangerous answer)
- **New route test** driving the real report/reply handlers on an ENFORCING board:
  - POST /api/report with only `from_pane`, no token ⇒ `recorded:false` (REFUSED). **This is the
    control that accepts today.** Same for /api/reply ⇒ `kept:false`.
  - Positive control: the SAME request on a NON-enforcing (sandboxed) board ⇒ accepted -- proving the
    test distinguishes, per `assert-presence-before-absence` / `aim-the-control-at-the-failure`.
  - With a valid board token header ⇒ accepted (same-account owner path works).
  - With a valid agent token ⇒ accepted (agent path unaffected).
- `server.paneless-sender.test.js` must stay green unchanged (3-arg extraction).
- CLI: extend the existing kosmos-CLI test (if present) to assert report/reply now emit the board
  token header; else assert via the server test above.
- Re-run the FULL suite (`node --test` + `bash tools/run-tests.sh`) locally before pushing -- a
  backend change should not touch web/, but re-run the whole thing regardless.

## Decision record (for the card)
- **Call:** two-part fix -- server tightens report/reply on an enforcing board (board-token OR
  agent-token, drop the pane fallback); the three same-account callers gain the board token. Enforce
  in `resolveAgentSender` via an opt param, not the dispatch gate, because only it sees `body.token`.
- **Rejected:** (a) enforce at the dispatch gate -- can't see `body.token`, would break the
  body-token credential path the card says to keep. (b) a bare inline pre-check duplicating the
  "is a token presented?" logic at both call sites -- drifts from `resolveAgentSender`'s own notion.
- **Weakest premise:** that `boardAuthState.on` correctly means "enforcing" for this purpose. It is
  set at boot to `boardauth.enforced(env)` = not-fully-sandboxed, the same gate #1946's dispatch
  uses -- so report/reply enforce exactly when the rest of the board does. If a board runs fully live
  with the token OFF (all four data dirs + TMUX_BIN pointed at real paths -- the inherited #1946
  limit), report/reply stay open too; that is the same operator-disarmed-their-own-board residual
  #1946 documents, not reachable by an attacker.
