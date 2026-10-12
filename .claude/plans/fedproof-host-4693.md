# #4693 follow-up: fed-own-e2e reaches its coordinator by name, not by IP

Branch `fedproof-host-4693`, off origin/main. Card: kosmos#4693 (Ice Cream Kitty, taken 2026-10-05 after
Renet released it).

## Why

PigeonPete, 2026-10-03, reasoned from source: `tools/fed-own-e2e.js` (merged 6e251b91c) runs its
coordinator at `http://127.0.0.1:<port>`, and #4699 (a6632f152) makes a board refuse an own code when
its Kosmos+ address has no computer domain. `engine/account-computers.js` `computerDomain` returns null
for an IP, a localhost or a two-label host, so `ownAccountNames` answers NO_COMPUTER_DOMAIN and the
own-code join is refused 409 `unchecked`. The proof could no longer pass, and nothing runs it on a
schedule, so nobody would see that.

## Call

- The coordinator gets `KOSMOS_DOMAIN=fedproof.localhost` and is reached as
  `http://login.fedproof.localhost:<port>`. computerDomain then gives `fedproof.localhost`, and the
  computers the coordinator names (`<name>.fedproof.localhost`) pass `validAddress`.
- `.localhost` names resolve to loopback (RFC 6761). macOS answers `::1` for them, so the harness
  looks the name up first and binds the coordinator to whichever loopback family it got
  (`[::1]:port` or `127.0.0.1:port`). A name that resolves anywhere else stops the run: dialling it
  could reach another machine.

- **Also widened: `NOT_CONNECTED` (step 7b).** engine/fedseats.js farSide words the not-connected note "the other
  computers in this project" for a project shared between one person's own computers, the case this harness runs. The
  old pattern knew only "the external project", so it matched none of the 37 notes the 10-06 02:54 run recorded.

## Rejected

- **A test-only switch in the board to skip the domain check.** It would put a bypass of a security
  check in the product to make a proof pass, and the proof would then not test what ships.
- **An /etc/hosts entry.** Needs root and changes the machine for everyone on it.
- **A two-label name such as `fedproof.localhost` for the coordinator itself.** computerDomain
  refuses fewer than three labels, by design.

## Weakest premise

That every client resolves the name the same way the harness's own lookup did. Node's lookup answers
`::1` here; the tunnel (Rust, getaddrinfo) is assumed to agree. The run itself is the check: a
tunnel that cannot reach the coordinator fails the sign-in step, loudly.

## Validation

- Both arms with the 10-03 relay binaries (renet-grace-1330): main's harness must FAIL at the
  own-code join (the defect, measured rather than reasoned); this branch must PASS end to end.
- Then this branch with a fresh debug build of kosmos-relay origin/main 703738ab (that was 10-06; see the re-run below).
- Results, 2026-10-06: this branch reported VERDICT PASS (49/49) on the machine queue (fedproof-arm-4693d.log).
- **Re-run 2026-10-11 23:23 CDT (Ice Cream Kitty), after rebasing onto main (2598 commits on):** VERDICT PASS (49/49
  checks, 54 s), through queued-heavy. The relay binaries were built from kosmos-relay origin/main 0578de95, which
  contains the live coordinator 9b3a8b7f, into their own external target.
  - Step 7a: "C is REFUSED A's own code [verify 409, join null]". Step 7c: the negative control reports FAIL for a
    string that was never posted.
  - **Built wrong twice first, recorded:** a first build ran in an old 10-05 worktree (703738ab). A second used the
    usage note's `-p ... --bin kosmos-coordinator`, which filtered the whole build to the coordinator binary, so
    kosmos-relay and kosmos-tunnel stayed Oct 6 artifacts. The third named all three binaries and checked each was
    newer than the build start. The usage note is fixed on this branch.
- **Not re-measured:** main's unfixed harness failing on current code (the control arm). It was measured failing on
  10-06. The cause is a design fact unchanged on main (a coordinator reached by IP has no computer domain, #4699).

## Review 1 (opus, 2026-10-11 23:2x)
- **SHOULD-FIX, taken:** the loopback check looked at the FIRST address only. On this Mac the name resolves to
  [::1, 127.0.0.1], and a resolver answering [::1, 10.x] would have passed. Now `lookup(..., { all: true })`, and
  EVERY address must be loopback.
- **SHOULD-FIX, taken (same lines):** the coordinator binds one family. The free-port check now requires the port to
  be free on BOTH 127.0.0.1 and ::1, so no other process can sit on the other family's port (cross-talk, not an
  escape).
- **SHOULD-FIX, taken, and the important one:** step 7a accepted ANY 4xx. Since #4699 verify answers 409 for several
  unrelated reasons, including `unchecked`, which is exactly what main's IP-addressed harness got. So 7a could print
  PASS with the account check never running. It now requires verify 409 with `reason: 'other-account'`.
- **NITs, taken:** the stale "an own code carries no account" comment, the 703738ab date, and a header line rewrapped.
- **Code changed after tonight's 49/49 run, so the harness runs again before the PR.**

## Review 2 (sonnet, 2026-10-11 23:36)
- **SHOULD-FIX, taken, and it matters:** review 1's stricter 7a sat inside the refusal branch only. A build that
  ACCEPTED another account's code (verify 200, join 200) skipped it, and the accept branch's relay checks pass on a
  true cross-account accept. So a regression dropping the account check at engine/federation.js stayed green. The
  check is now asserted before the branch, on every path. The header's step 7 text (which still described C joining)
  is rewritten to match.
- **SHOULD-FIX, taken as a claim fix:** the both-families free-port check is checked once, at start; the coordinator
  binds one family, so a process taking the other family's port later is not excluded. Local cross-talk only. Binding
  both families is not possible with one KOSMOS_LISTEN, so the comment now says what is actually checked.
- **Comment added:** the loopback allowlist is stricter than loopback (127.0.0.2, ::ffff:127.0.0.1 stop the run). That
  fails closed, which is the safe direction.
- **Not measured:** a mutant where the product accepts the code. It needs a modified engine and a full harness run;
  the fix is a move of one assertion out of a branch, checked by reading. Weakest point of this round.
- Confirmed by the reviewer against source: 409 other-account is returned only at engine/federation.js:392, after the
  account check ran; the usage note's build line builds all three binaries.

## Review 3 (opus, 2026-10-11 23:38)
- No blockers. Confirmed against source: other-account is reachable only after ownAccountNames ran on a signed
  coordinator answer with a computer domain and a valid address list; an empty list, an unallowed C, or a missing
  domain all end in unchecked and now FAIL 7a. Step 5 is the matching same-account control through the same path.
- **SHOULD-FIX, taken:** the comment's list of 409 reasons omitted already_joined; it now says "among them".
- **SHOULD-FIX, taken:** the NOT_CONNECTED widening was not recorded here; added under Call.
- **NITs, not taken:** the name is checked once and re-resolved by clients later (already the weakest premise above);
  `coordAt` keeps the whole record (harmless).
- Comment and plan only. No behaviour changed, so the queued run on this head is the measurement.
