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
- Then this branch with a fresh debug build of kosmos-relay origin/main 703738ab.
- Results: pending (queued on the local machine queue, 2026-10-05).
