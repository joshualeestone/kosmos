# cloudlock-7285: two more ways to lose a cloud machine's only way in (kosmos#7285, from #7277)

Stacked on cloudremove-7277 (rebase onto main when #7277 merges).

## Finished looks like
Item 2: on a Kosmos cloud machine an unreadable or missing remote.json keeps the tunnel wanted (on any other computer
it still reads as off). Item 1: removing or "Not me" on the requesting browser's own device on a cloud machine is
refused (Remove until kosmos-relay S4 ships; Not me always), or shown not to be a lockout.

## Built
- Item 2: engine/remote.js cloudKeepsOn(), used by ensure(); read() unchanged (still honest: ok:false). Logged once.
  Test: engine/remote-cloudkeepson-7285.test.js (damaged and missing keep on; a readable off is off; non-cloud control).

## Open
- Item 1 needs the requesting browser's device id on the board, which it does not have today (the tunnel does not
  forward it; self_device_id exists only in test stubs). Asked PigeonPete (gate owner) whether the tunnel can forward
  it. Refusing Remove/Not me for EVERY device on a cloud machine was rejected: it would stop removing a lost phone.
