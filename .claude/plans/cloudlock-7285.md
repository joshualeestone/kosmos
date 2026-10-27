# cloudlock-7285: two more ways to lose a cloud machine's only way in (kosmos#7285, from #7277)

Stacked on cloudremove-7277 (rebase onto main when #7277 merges).

## Finished looks like
Item 2: on a Kosmos cloud machine an unreadable or missing remote.json keeps the tunnel wanted (on any other computer
it still reads as off). Item 1: removing or "Not me" on the requesting browser's own device on a cloud machine is
refused (Remove until kosmos-relay S4 ships; Not me always), or shown not to be a lockout.

## Built
- Item 2: engine/remote.js cloudKeepsOn(), used by ensure(); read() unchanged (still honest: ok:false). Logged once.
  Test: engine/remote-cloudkeepson-7285.test.js (damaged and missing keep on; a readable off is off; non-cloud control).

- Item 1: server.js devices/(remove|deny): on a cloud machine, from a remote session, refused (409 own_device_cloud)
  when the id is the requesting session's key or device, named by the tunnel's x-kosmos-session-key /
  x-kosmos-session-device (PigeonPete builds them in kosmos-tunnel, #6595's pattern; agreed 21:55). Inert until that
  ships. Test: server.cloudowndevice-7285.test.js (both verbs, key and device; controls: another device, no headers,
  local, not cloud).

## Decided
- Trust the headers without the connector capability check that step-up needs: here a header can only cause a
  refusal, never let a removal through, so forged or missing is safe.
- Refuse Remove of your own browser even after S4 (where a fresh sign-in would let it back): nobody needs to remove
  the browser they are using, and another device can. Rejected: refusing Remove/Not me for every device on a cloud
  machine (it would stop removing a lost phone).
- Weakest premise: that the page shows the route's error sentence when a Remove is refused (it shows the route's
  error for other refusals); no page change here.
