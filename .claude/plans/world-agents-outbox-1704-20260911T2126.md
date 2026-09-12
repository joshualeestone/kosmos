# Plan: world-agents-outbox-1704 (PR2 of the named-world agents plan)

Parent plan: `.claude/plans/world-agents-1704-20260911T2145.md`, section 5 ("Keep
running: nothing sent is lost") and section 8's PR2 entry. Base: main `b69e62eb`.

## What

Josh's decision 2: on a world switch the person may choose to keep a Kosmos's
agents running. Board tokens are per world, so today a kept-running agent's reply,
message or post reaches the board that is serving ANOTHER world, is refused (403
on an enforcing board), and is lost. This slice makes nothing sent get lost:

1. Every agent-side request names its world: an `x-kosmos-world: <id>` header
   (`default` when `KOSMOS_WORLD` is absent) from the Windows CLI
   (`tools/windows/kosmos-cli.js`), the Windows report hook
   (`engine/kosmos-report-hook.js`), the Codex bridge (`bin/codex-report-bridge.js`)
   and the Mac CLI (`install/kosmos` `kosmos_curl`).
2. The board refuses a world mismatch BEFORE its token checks: a loopback POST to
   `/api/report`, `/api/reply`, `/api/msg`, `/api/post` or `/api/react` whose
   header is PRESENT and names a world other than the one the board booted into
   gets `421 {wrongWorld:true, serving, because}`. An absent header (the web page,
   older clients) behaves exactly as today.
3. On a 421 the client keeps the send in its OWN world's outbox
   (`<store.ROOT>/outbox/<ts>-<rand>.json`, new `engine/outbox.js`): reply, msg and
   post are kept and the command exits 0 with "Kept. Your Kosmos is not the one
   open right now; it will be there when it is."; a report is dropped as stale
   (one line, exit 0; the hook stays silent); react and the other verbs exit 1
   with a sentence.
4. The board drains its world's outbox once it is listening and every 60 s:
   replies land in the agent's thread with their original time, posts and
   messages go through the same functions the routes use.

## Design decisions (where the parent plan left latitude)

- **The header name lives in `engine/launchidentity.js`** (`WORLD_HEADER`), next
  to `WORLD_ENV_VAR`, because that module is a leaf with no requires: the hook,
  the bridge, the CLI and server.js can all load it before anything that freezes
  `store.ROOT`. Its world normaliser (`worldIdOrDefault`) is what
  `currentWorldId` already did, extracted so the board normalises the header and
  its own booted id with the same rule. The shell copy in `install/kosmos` is
  pinned equal by a test.
- **The 421 is scoped to the five agent POST routes**, not to every `/api/*`
  request. `kosmos_curl` sends the header on every call, including person-side
  ones like `kosmos open` (board-nonce) run from a terminal with no
  `KOSMOS_WORLD`; a board-wide rule would refuse the person's own `kosmos open`
  while a named Kosmos is open. It is loopback-only (a network peer never learns
  the booted id this way), and it runs before the #1946 board-token gate so a
  world-A agent presenting world-A's token hears "wrong world" rather than a
  misleading "belongs to another account". Nothing new leaks: the booted world id
  is already public in `x-kosmos-board: build@world` on `GET /`.
- **Outbox format and caps.** One JSON file per send, `{verb, body, from, at}`,
  written with `securewrite.writeSecret` (temp + rename, 0600) into a directory
  made 0700 by `securewrite.secureDir`, the store's own secret-write path. The
  body is the exact JSON the client sent the route. Caps are named constants:
  500 entries, 16 MiB in total, 96 KiB per entry (a msg body may be up to
  `messages.MAX_BODY`, 64 KiB). A full outbox refuses the keep with a sentence
  rather than dropping older sends.
- **`from` is resolved at keep time**, in the agent's own process: the launch
  token through `sendertoken.resolveName` (Windows, and Mac agents minted since
  #1077); otherwise the tmux session of `TMUX_PANE` through the same
  `messages.paneSession` the pane route uses (Mac); otherwise the keep is refused
  with a sentence. A token that is presented but does not resolve is a refusal,
  never a fall back to the pane (the no-downgrade rule of `resolveAgentSender`).
- **The shell keeps through Node.** On a 421 `install/kosmos` writes the JSON body
  it already built to a mode-600 temp file and runs
  `node <engine>/outbox.js keep <verb> <file>`; message text never rides argv
  (#1970). Node and the engine directory are resolved by two helpers extracted
  from `board_token` (installed layout first, source checkout second), so the
  shell has one derivation of each. The 421 is detected by the body's leading
  `{"wrongWorld":true` key, the same anchored-glob style the shell already uses
  for `post` and `react`, so no curl call changes shape.
- **One path per verb (convention 5).** The reply record (`keepAgentReply`) and its
  text checks (`agentReplyProblem`), and the room post (`sendRoomPostAsAgent`),
  are extracted in server.js so the routes and the drain share them. A msg goes
  through `messages.send`. The route keeps its original `at`-less behaviour; the
  drain passes the kept `at`.
- **"The sender gets a note" uses the messages record's `refused` row.** The DIRECT
  thread has only two authors (the person, and the agent whose thread it is), and
  `dmRow` draws any row with `from` as the agent's own words, so a Kosmos-written
  note there would put words in the agent's mouth. The board already records an
  agent's send that did not land as `{kind:'refused', from, to, because}`;
  `send()`'s own refusal logger is extracted as `messages.logRefusedSend` and the
  drain writes the not-in-this-Kosmos note through it.
- **Retries are bounded by age.** A kept msg or post that cannot be placed stays
  and is retried, but `OUTBOX_RETRY_MAX_AGE_MS` (7 days) drops one that still
  fails, with a log line (and a refused row for a msg), so a permanently refused
  entry cannot be retried forever.
- **"An agent in this Kosmos"** is a profile in this world's store or a tied card
  on the roster (`knownAgent`), so a stopped agent still counts and an adopted
  agent with no profile still counts.
- **Drain wiring and gating.** The drain appends to the board's own thread and
  message records and delivers through the paths the routes already use; none of
  that is gated by `live-execution` in this codebase (`chat.deliver` has its own
  dry-run seam). So it is not gated on `liveExecutionAllowed()`. It is started only
  from the real-start path (`require.main === module`, after
  `allowLiveExecution()` and once `start()` has resolved, which is after
  `listening`), on an unref'd 60 s timer, never at require. Tests call the
  exported `drainOutboxNow()` directly.
- **`name@world` is not handled.** Neither CLI has an `@` form, and an `@` can never
  be in an agent name, so such a send is already refused by the board as an
  unknown recipient. No client-side refusal is added.

## Tests

- `server.world-outbox-1704.test.js`: the 421 fires for each of the five routes
  only when the header is present and differs; an absent header and a same-world
  header are unchanged; a null booted world is the default world; on an enforcing
  board the 421 comes before the token check, and a same-world header still
  meets the token check; a non-agent route ignores the header. The drain: a
  reply lands in the thread with its original `at`; a forged `from` is dropped;
  a msg to a name not in this Kosmos is dropped with a refused row for the
  sender; a post reaches the same function as `/api/post` (same refusal for a
  missing project).
- `engine/outbox.test.js`: keep/list/remove, atomic write (no temp left, 0600 on
  POSIX), the entry and size caps, validation, `from` resolution (token, pane,
  neither, token that does not resolve), and the drain's retry/drop/age rules
  with injected deliverers (a msg is retried until placed).
- `tools.windows-kosmos-cli-outbox-1704.test.js`: against a local HTTP stub, a 421
  on reply/msg/post keeps an entry and exits 0 with the sentence; a report is
  dropped (exit 0, nothing kept); react exits 1 (nothing kept); the header rides
  every request.
- `engine/kosmos-report-hook.test.js`: the header is sent; a 421 on SessionStart is
  silent and keeps nothing (and a 500 control still speaks).
- `codex-report-bridge.test.js`: the header is sent, with the world from the env.
- `cli.world-outbox-1704.test.js`: `install/kosmos reply` against a stub `curl`
  that answers 421 writes an outbox entry through the Node entry; the header line
  is in the header file; the shell's header name and sentences equal the JS
  constants.
- Root inventories re-run: `engine.reachable.test.js`, `one-derivation.test.js`,
  `fixture-discipline.test.js`, `server.worldenv-order.test.js`.

## Weakest part

Trusting `from`. It rests on same-account files: the token store and the pane both
belong to the account that runs the agents, which is the same trust the
`board.token` class already has. A process of that account could write an outbox
file naming another agent; the drain only checks that the name is an agent in
this Kosmos. That is no weaker than a pane-derived report, but it is not a
credential check.

Second: the Mac. Mac agents carry no `KOSMOS_WORLD` yet (PR1m), so every Mac agent
says `default`. On a Mac board serving a named world, a default-world agent's send
is now kept (was a 403 and lost), which is the point. A Mac agent created in a
named world cannot exist yet (#2849 refuses the spawn), so none is misrouted. The
shell path is exercised here in Git Bash with a stub curl; the real Mac curl and
bash 3.2 are for macOS CI.
