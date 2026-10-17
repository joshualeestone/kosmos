# boardproof-1765: the board proves itself before a client sends it a token

Card: kosmos#1765 (security audit pass 3). Details are private; this file states only the design and its
operational limits.

## What changes
- `engine/boardproof.js` (new): the key id, the proof (HMAC-SHA256 over the address, the port and a fresh nonce,
  keyed on the token), the board's answer, and a node client check (`boardHoldsToken`, one deadline for the whole
  exchange). For node senders it also gives the gate the report bridges will call, `mayCarryTokensTo(baseUrl,
  headers, { fetchImpl })`: true when the headers carry no token (read through `new Headers`, so any shape fetch
  takes and any case; the board cookie by boardauth.cookieToken itself, in the board's own order) or the listener
  proved it holds the one they carry; false for headers it cannot read. An optional `onRefuse(why)` hears why a
  check came out false, so a sender can record it where its own output allows. Clients accept http://127.0.0.1 only (not
  localhost, which can be ::1). Both node paths refuse an answer over PROOF_ANSWER_MAX_BYTES; the http path
  and a fetch with a readable stream stop reading there, while a fetch without one (node-fetch v2, a stub) reads it
  whole first, bounded only by the deadline. Through fetch, redirects are refused. As a program it does only the arithmetic for the CLI: `--key` and `--verify <base url>` (127.0.0.1
  only), input on stdin. The nonce size, key-id length and answer cap are named constants, and the CLI's copies
  are pinned equal by a test.
- `server.js`: `GET /api/board-proof?n=<32 hex>&k=<16 hex>` is exempt from the token gate. It answers for the
  board token, the world tokens the gate accepts, and the agents' tokens (a cached agent key first, then the board
  and world tokens, then a rescan; by a key-id map: a key id in it is answered from it, and one not in it rereads
  the token files when the token folder changed or the map is 30 s old), bound to the address and port the asking
  connection reached. A board started without enforcing answers for its account's token file, which the CLI reads
  and sends all the same; an enforcing board that could not load its own token proves no board token (its gate
  accepts none) but still proves the world and agent tokens its gate accepts. Loopback peers only. 404 for any
  other key id, 400 when malformed. A worlds list or agent-token folder it cannot read is logged; a single token
  file that cannot be read is skipped silently by the readers it uses (boardauth.readToken, sendertoken); the
  agent-key map that results is rebuilt on a miss once it is 30 s old, so a transient skip does not stay cached.
- `install/kosmos`: `kosmos_board_proven` runs before `kosmos_curl` sends any token. The proof goes by curl on the
  same route (#4933) within half the caller's -m (0.5 to 15 s); the request gets the caller's -m less the proof's
  time. Outside both: two node starts, the #4933 route check and the 0.5 s floors. Every refusal sends nothing and
  has its own code: 5/6/7 could not connect (as before), 97 the proof timed out or was cut, 98 something answered
  but could not prove it (including an answer that is not HTTP, curl 1 or 8, or one over the cap), 96 the CLI
  could not run the check. KOSMOS_PROOF_DEBUG=1 names the failing step on the terminal (stderr when there is none). 97 and 96 are new codes because callers read curl's
  18/28/52/56 as "may have landed". `say_unreached` words each; whoami, connect and task ran word them through it
  too; `kosmos open` refuses to open the browser at all (the browser would send the board cookie, which holds the
  token), on 98, 96, 97, and on 5/6/7, 52 or 56 after the health check; `kosmos community comment` counts all three as not sent; the task-run retry retries 97. The Mac report hook
  goes through the CLI, so it is covered in the installed layout (not when it runs the source checkout's CLI). `kosmos connect`'s interrupt marks a stop file (KOSMOS_CURL_STOP) that the proof checks before each step and the
  request once, removes its body file, and stops the step running now (the proof's curl writes to a file, so it is
  the subshell's own child). The body file's removal is what keeps the request from going out if its curl has
  already started (curl reads the body before it connects, measured on curl 8.7.1: exit 26, nothing sent); the stop
  file only skips later steps. When a call carries both a board token and an agent token, only the
  board token is proved (a listener holding it is this board).

## Not covered by this PR
- The other senders and token carriers, and the deliberate fail-open cases, are listed in the private notes on
  #1765. The report bridges follow in bpbridges-1765 (Ice Cream Kitty); the Windows senders are Homer's.

## Operational limits (stated, not missed)
- A sender whose token the board does not hold for the world it serves gets 98 where it used to get 421 and keep
  the message for later: a token-only agent (KOSMOS_AGENT_TOKEN_ONLY=1, a pilot) from another world, and a
  board-token sender of a world created or hidden after the board started. The message is not kept.
- After an update the CLI is new before the board restarts: until it does, an old board has no proof route and
  every token-bearing call is refused with 98 (its words say to restart Kosmos if it was just updated).
- An oversized proof answer is refused as 98, like any other unproven answer.
- A port mapping between client and board (ssh -L, a VM or container forward) makes the dialled port differ from
  the board's, so every call is refused with 98. The #4933 proxy is fine: it dials the board's own port,
  from a loopback address (the route answers loopback peers only; a proxy connecting from another address gets 98).
- A call with a long budget (post -m 120, accounts -m 60) gives the proof at most 15 s: a board busier than that
  now reads as 97 (not sent) where the call used to wait it out.
- `kosmos open` refuses to open the browser when the proof does not succeed, a busy board included (one slower
  than half its 15 s), and when the board stops answering after the health check (5/6/7), where it used to open
  the plain address: the browser would send the board cookie.
- The proof route needs no token, so any local process can ask it for unknown key ids. Each costs a stat of the
  worlds registry and of the agent-token folder (with the registry's read cached on its mtime; with no registry file,
  the single-world install, the registry read is tried each time), plus a stat of the board token file on a board
  started without enforcing. There is no rate limit, since one would refuse real clients under load.
- A token written by securewrite's in-place fallback (after three failed atomic attempts) does not move the token
  folder's mtime, so it is proved only after a later change to that folder; its agent is refused (98) until then.
- A caller's `-m 0` is curl's "no limit": the proof then takes half the 15 s default (7.5 s), and the request keeps
  no limit.
- Agents are told not to restart Kosmos on a 98 (#4466); the restart advice is worded for a person.
- Risk for the short hooks (-m 3: undo keep, tool failed): the proof may take up to 1.5 s of the 3. A proof slower
  than that is refused (97, not sent); after a proof the send keeps what is left, at least 1.5 s, and a send that
  runs out exits 28 ("may have landed") as before. So against a busy board a call that used to finish in 2.5 s can
  now fail.
- A listener that accepts and then drops the connection reads as 97 ("did not finish answering"), the words for a
  busy board, and task ran retries it; nothing is sent either way.
- Test runs: five other CLI tests build the installed layout (cli.task-webhook-1307, cli.unknown-flag-4889,
  cli.body-file-5970, cli.feedback-2037, cli.update-ifnewer-4382) and stay off the proof only because they carry no
  token (no board.token in their data dir; tools/run-tests.sh unsets KOSMOS_AGENT_TOKEN). Run by hand with
  KOSMOS_AGENT_TOKEN set, their stubs would refuse the proof (98). Many more (about 45) build an installed layout
  whose stub engine has no boardproof.js, so they take the missing-file path and send unproven to their stubs; any
  of them that starts linking the real engine will meet the proof. The rest run the checkout layout, unless the
  runner exports KOSMOS_HOME pointing at an installed bundle (unset on the fleet Mac, 10-17).
- `mayCarryTokensTo` has no caller until the bridges PR, so engine.reachable.test.js excuses it by name until then.
- Cost: per call, two node starts and one extra loopback curl (nothing is remembered between calls). The CLI's
  answer cap holds on curl 8.4 and later (measured on 8.7.1, 10-17); on an older curl a chunked answer is bounded only by the proof's time
  limit.

## Tests
- `server.board-proof-1765.test.js`: real board; answers for its token and an agent token, bound to its port; 404
  for another token; 400 when malformed; a squatter and a dead port read false; the fetch path and
  `mayCarryTokensTo` agree with the http path (any header shape and spelling, unreadable ones refused, localhost
  refused before any request); a relay on another port that passes the real board's answer through is refused;
  one deadline holds against a trickling listener on both node paths; an answer over the cap is refused on both
  paths while the same proof under it passes; the CLI helper's exit codes (--key 1, --verify 4 and 3); a POST is
  still refused by the token gate; answer() binds the address (unit level). Not tested: the non-loopback 403; the
  key-id cache on a second mint, rotation or revoke; the token-file fallback on a non-enforcing board; the
  world-token branch; redirect refusal; and end to end, a board listening on every address (so the route's use of
  the connection's own address is tested only through answer(); the harness cannot start a board on a second
  address).
- `cli.board-proof-1765.test.js`: installed layout. A proven board gets the token; a squatter (a wrong proof, or a
  404 page) and a listener that never answers get nothing, each with its own words (matched on their fixed parts);
  community comment refuses with exit 1, not "may have been taken"; a token-only agent (whoami) proves its agent token; the
  CLI's answer cap and nonce size equal the module's; an interrupt of `kosmos connect` while the proof stalls
  stops in under 2 s, sends no token and leaves no file; with the stop file already present a call sends nothing,
  not even the proof request (CONTROL: without it, the same call sends); `kosmos open` opens no browser at a squatter (CONTROL: it
  does open at a proving board). CONTROL: the checkout layout sends each token to the same
  squatter. Partly tested: the -m arithmetic (a silent listener gives up at the 15 s cap). Not tested: the stop file and the body-file removal through `kosmos connect`'s interrupt (the moment between
  steps cannot be hit reliably; the interrupt arm lands during the proof's curl, which the kill handles alone, and
  the stop-file check itself is tested directly); the 5/6/7 pass-through from the proof's connect (and open's refusal on it), the -m rewrite, the 96 path, the task-run retry on 97, the connect
  refusal words, the msg and post retry clamp (a refused retry stays "maybe"), and the CLI's oversize (curl 63)
  mapping.
