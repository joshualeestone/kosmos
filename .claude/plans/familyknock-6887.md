# familyknock-6887 (kosmos): the family proof knocks at P, so step 4b can pass again

Card: kosmos#6887 (filed by Baron 10-21, taken 10-22 00:59 night shift).

## Why 4b was red
kosmos-relay #433 (knock-6407, merged 2026-10-18 04:48) lists a phone or browser on a computer's Allow screen only
after it knocked at that computer's own gate within a day (`asked_here`, crates/tunnel/src/devices.rs). The harness
(written 10-15) never knocked; its own comment said "this harness has no browser to knock". So P never listed the
parent's browser, and steps 6 to 11 could not run.

Two more gaps sat under that, both found by running with the knock in place:
1. The relay ran with its placeholder domain (`--domain` default `kosmos.invalid`) while the coordinator ran with
   `KOSMOS_DOMAIN=fedproof.localhost`, so the relay refused every tunnel's ticket ("ticket authorises
   famp-....kosmos.invalid but the client asked for famp-....fedproof.localhost") and no visitor could reach a board.
   Nothing before needed a visitor to reach a board, so it never showed.
2. The tunnel's gate asks for the second sign-in step unless `KOSMOS_REQUIRE_SECOND=0` (gate.rs
   `require_second_from_env`), and this run's coordinator mints sessions with none, so the gate refused the browser
   as "that sign-in is not valid any more".

## The change (tools/family-e2e-6239.js only)
- `knockAt(b, token)`: TLS to the relay's public port with SNI = the board's registered `address`, trusting `ca.crt`
  from its tunnel state, then `POST /_kosmos/session` with the session, as kosmos-relay crates/e2e/tests/door.rs does.
- 4b gains one check: the gate answers 403 `{"pending":true,"code":...}` with the code the sign-up showed. STEP_CHECKS
  4b goes 3 -> 4 (25 checks).
- The relay gets `--domain FEDPROOF_DOMAIN`; each board's env gets `KOSMOS_REQUIRE_SECOND: '0'` (the tunnel inherits
  the board's env, engine/remote.js).

## Measured (Agent1s, 2026-10-22; binaries built from kosmos-relay origin/main 3b3ad987d, debug, --locked)
- With the change: VERDICT PASS 26/26, 62 s (log ~/.cache/claude-handoffs/baron-jobs/e2e-6887d.log).
- Control, the same file with only the knock call disabled: 4b red ("P lists the parent's browser" fails after 60 s),
  6 to 11 never run (e2e-6887-ctl.log). So the knock is what makes P list the browser.
- Before the domain fix: the relay log shows the ticket refusal above (e2e-6887b.log run). Before the second-step fix:
  the knock answered 403 "that sign-in is not valid any more" (e2e-6887c.log).

## Rejected
Writing knocks.json directly, as the relay's unit tests do: the harness cannot know the browser's device id (the
coordinator replaces the id a browser offers, #5422, and the sign-up answer does not return it), and it would skip the
gate a real browser goes through.

## Weakest premise
That the second-step refusal was the reason for "not valid any more": the tunnel logs to stdout, which the board
discards (engine/remote.js spawns it with stdout ignored), so its refusal line was not read. It is the only refusal in `admit` that fits the state on disk (own account matches, no cutoffs, not a
computer id), and setting the variable alone turned it into 403 pending.

## Not changed
tools/fed-own-e2e.js starts its relay the same way (no `--domain`), but no step there needs a visitor to reach a board.
boardEnv and the relay args are outside the helpers kept in sync by tools.fedproof-helpers-in-sync-6287.test.js.
