# #4693: end-to-end proof that two computers of one Kosmos+ account share a room

Branch `fedproof-4693`, based on `origin/selfroom-4649` (58e8702e4, Ice Cream Kitty's #4649 code).
Deliverable: `tools/fed-own-e2e.js`, a harness anyone can run (usage in its header).

## Call

A single node script drives the real pieces, all local and debug-built: the kosmos-relay
coordinator and relay (origin/main 31b4b7ca, which carries #213 own-room ticket + per-computer
seat, #214, #215 `fed-room --own-project`), and three boards run from this checkout, each fully
sandboxed (data root, workers, projects, launch dir, HOME, tunnel state, fake tmux with a
typed.log), on free 27xxx ports. Everything lives under one mktemp sandbox, removed at the end.

- The account is made through the coordinator's web sign-up (`/v1/signup/start|verify`), with the
  terms version read off the served `/signup` page. The board's own setup route cannot create an
  account (coordinator answers `terms_required`, #4454), so this is the only real way in.
- Both boards then sign in through the board's own Plus wizard routes (signin-start, verify,
  register), reading each dev code off the coordinator's stdout (KOSMOS_DEV_MODE=1,
  KOSMOS_REQUIRE_SECOND=0).
- The relay is pinned to the key `/v1/meta` reports, the same key each state dir pins.
- Seats are observed at the relay: its `federation member authenticated room=.. member=..` lines.
  A member is `<account>:<mac_id>`, so "one account" and "each computer its own seat" are both
  read off the member ids and matched to each board's own `mac_id`.
- Delivery is observed as an `[external person]` row in the other board's `?as=text` room.
- Processes are stopped by exact pid: each started pid, its descendants (seats, tunnels) walked
  from `ps`, and any pid whose command line names this run's sandbox. Never a pattern kill.

## Rejected

- **Board setup-start/complete to create the account.** Tried first: the coordinator refuses to
  create an account without accepted terms (`terms_required`), by design (#4454).
- **Hardcoding the terms version.** It changes (signin.rs `TERMS_VERSION`); reading it off the
  served page keeps the harness honest when it does.
- **Reading seat state from the board.** `fedseats.statusOf` is not exposed over HTTP; the relay
  log is the observable that can tell one seat per account from one seat per computer.
- **Failing the run when a different account's computer accepts the own code.** The card says
  such a board "cannot join". It can join LOCALLY (the own code carries no account), and the
  harness asserts the safety property instead: C is seated in a different room and nothing
  crosses in either direction, while a live control proves the watch could see a delivery. The
  acceptance itself is printed as a NOTE and reported to Kitty (below). If #4649 decides the code
  must be refused on another account, turn the NOTE into a check.

## Weakest premise

The relay's log lines are the seat observable. If the relay's tracing format or its member
naming changes, step 6's seat checks fail loudly (they cannot pass vacuously: no parsed member
means no room with two members), but they would need updating rather than signalling a product
bug. Second: the relay-down control (7b) stops the relay, then posts on A every 0.5 s for up to
30 s (SEND_MS) until a post is answered by the not-connected note as its very next row. Posts
before the seat noticed are printed as a NOTE and are all watched for non-delivery too. A seat
that never notices within 30 s FAILs 7b (a real finding or a timing flake, read from the board
log).

## Measured

- Final run 2026-09-30 06:47 UTC: VERDICT PASS, 33/33 checks, 46 s. Earlier runs under box load
  took 113 s, 124 s and 195 s; one run failed at step 1 when the coordinator did not answer within
  the then 20 s wait (load). The wait is now 60 s and a coordinator that exits at start is
  reported at once.
- Sabotage run (B signed in to a DIFFERENT account, scratch copy, deleted): step 6 FAILED as it
  must ("two seats up in ONE relay room"), VERDICT FAIL. So the same-account seat assertion is
  not vacuous.
- Step 7c: the detector reports absence for a string never posted (the harness's own negative
  control). Step 6 control: B's own local post does appear in B's typed.log, so the "inbound was
  not typed into a pane" checks are made with an instrument that can see a typed line.
- Step 7a control: in the same 12 s window where nothing crossed between C and A/B, A's second
  post did reach B.
- Leftovers after runs: no process naming the sandbox, no sandbox directory left.

## Findings for Ice Cream Kitty (#4649)

1. **An own code is accepted on a DIFFERENT account's computer, which then gets a room that can
   never connect, and is told the opposite.** Steps: account 1 makes an own code on board A
   (`POST /api/federation/own-code`); board C, signed in to account 2 with Kosmos+, posts it to
   `POST /api/federation/verify` then `POST /api/federation/join`. Expected: a refusal saying the
   code is from another Kosmos+ account (or, at least, no claim that it is shared). Actual: verify
   200, join 200, a project "Shared ..." whose seat sits alone in account 2's own room
   (`derive_room(account 2, ref)`), and the room note "This project is shared with your other
   computers." C's posts are placed and go nowhere, with no "stayed on this computer" note because
   the seat IS connected. Nothing crosses accounts (safe), so this is a wrong-promise bug, not a
   leak. Where: engine/federation.js `parseOwnCode` / `verify` own branch (the code is
   `{v, ref, name}` with no account), server.js `/api/federation/join` (the `snap.own` note).
2. **Minor wording:** with the relay down, an own-account room says "That message stayed on this
   computer: the connection to the external project is not up right now." (engine/fedseats.js
   `post`). For a room shared only with the person's own computers, "external project" is the
   wrong noun; same family as #4657.

## Review iteration 2

Blind sonnet review of b23c0b463 found WARNINGs, all fixed in tools/fed-own-e2e.js:
- The pane recorder (typed.log) only logged `set-buffer`, so a federated text typed by
  `send-keys`, `paste-buffer` or `load-buffer` would be missed. The wrapper now logs every
  non-read verb (and load-buffer's stdin or file), and a step 3 control drives all four verbs
  plus a read and requires exactly the four.
- The absence watches (7a, 7b) could pass on an unreadable room (it reads as ''). Each now
  ends with a control that every room it read still holds its own post.
- The 7a refusal branch was a silent NOTE; a refusal must now be a 4xx at verify or join, so a
  crash or timeout cannot read as "refused". C's seat must also be a DIFFERENT account.
- A spawn 'error' event, or any throw outside main (event handler, stray rejection), could skip
  cleanup: now logged / routed to fedproofFinish. A stopped child's pid is never signalled.
- Binaries are checked for X_OK, not just existence.

Measured 2026-09-30 06:34 to 06:37 CDT, over that exact tree (cmp-identical to the tested copy):
clean VERDICT PASS 54/54, 36 s. Mutations, each restored and cmp-checked after: set-buffer-only
recorder FAILs step 3 control; unreadable B room FAILs step 7b control; injected stray throw
FAILs as harness error (uncaughtException); forcing the refusal branch FAILs "C is REFUSED"
(verify 200, join 200); non-executable bin dir FAILs at start. Zero leftover processes or
sandbox dirs after every run.

## Review iteration 3

Blind sonnet review of 72790bc7b: no BLOCKER, 4 WARNINGs, 2 NITs.
- W1 (fixed): an exited entry's pid was still walked for descendants, so a reused pid could hand
  it a stranger's children. Descendants are now walked only while the parent is live and
  remembered with their command line; after exit only a remembered pid with the same command
  line is signalled.
- W2 (fixed): the orphan sweep matched any process naming the sandbox (a `tail -f` of a log).
  It now also requires the process to run one of this run's binaries, node, or a sandbox script.
- W3 (fixed): SIGHUP and SIGQUIT now tear down like SIGINT/SIGTERM, and an `exit` handler
  SIGTERMs every live started pid if the async cleanup did not finish.
- W4 (fixed): the Weakest premise paragraph described a 3 s pause the code no longer has; it now
  describes the post-until-noted loop.
- NIT1 (deferred): the step 3 recorder control drives only A's wrapper. B's and C's are made by
  the same function, and B's own-post typed.log control exercises B's at runtime.
- NIT2 (deferred): the step 6 "no disconnect" check reads net membership, so a flap between polls
  would net out. It proves "up now"; a flap is not the property this card asks about.

## Review iteration 4

Blind sonnet review of be0be253c: no BLOCKER, 1 WARNING, 4 NITs.
- W1 (fixed): a relative FEDPROOF_BIN_DIR resolved differently for services (cwd SANDBOX) and
  boards (cwd REPO), and the orphan sweep could never match a seat. BIN_DIR is now path.resolve'd.
- NIT (fixed): the "sandbox script" sweep clause could not match, since a script shows in ps as
  `/bin/sh <sandbox>/...`; an interpreter followed by the sandbox path now counts.
- NIT (fixed): after SIGHUP, stdout writes can fail with EPIPE/EIO and feed the error handler;
  stdout/stderr errors are now swallowed.
- NIT (deferred): the remembered-descendant map is refreshed only at teardown, so a board that
  dies mid-run leaves seats only the command-line sweep catches. It does catch them (seat argv is
  the run's tunnel binary plus a sandbox --state-dir); no other descendant kind exists today.
- NIT (deferred, documented here): the `exit` last-resort handler signals only started pids, not
  seats; a hard exit that skips the async cleanup can leave seats. Corrected in iteration 5:
  nothing reports that afterwards (the harness has no startup leftover check).

## Review iteration 5

Blind sonnet review of 5a4b3eff7: no BLOCKER, no WARNING. Converged. NITs, all deferred:
- If fedproofCleanup ever threw, fedproofFinish would never reach process.exit and the run could
  hang. Every cleanup step except the (wrapped) rmSync is non-throwing today.
- The 7b absence watch brackets B's readability at start and end only, not mid-window.
- The exit fallback signals started pids only (already deferred in iteration 4).
- Fixed as text: the plan and a code comment claimed the next run reports leftovers. It does
  not; a SIGKILLed harness can leave seats and a sandbox dir with no signal. Both now say so.
