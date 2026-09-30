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
bug. Second: the relay-down control stops the relay 3 s before posting; a seat that took longer
to notice would write into a dead connector and the "stayed on this computer" check would FAIL
(a real finding or a timing flake, to be read from the board log).

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
