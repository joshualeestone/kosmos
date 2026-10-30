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

## Review
- Round 1 (cloudlock-7285-review1.md): 1 blocker, 1 warning, 2 nits, all fixed. BLOCKER: the keep-on did not stick (a
  missing file reads as a readable off, and the next ordinary save wrote off into it): the file is now repaired to on
  there and then, as the switch repairs it on a Mac. The test proves the repair holds after a save and pins that
  ensure() uses cloudKeepsOn; a comma-joined header counts every piece; the log line says missing or damaged and
  whether the file was written again.
- Round 2 (cloudlock-7285-review2.md): 0 blockers, 1 warning, 2 nits, all fixed. Only a MISSING file is written again
  with on; a file that is there but cannot be read is kept on in memory each tick, never rewritten (every ordinary save
  already refuses it; a rewrite from blank would drop this computer's ids). The log says missing or unreadable once per
  loss; the ensure() pin matches the decided line exactly. Asked PigeonPete: the header values must be the ids the
  Devices list carries, or item 1 does nothing (harmlessly).
- Round 3 (cloudlock-7285-review3.md): 0 blockers, 0 warnings, 3 nits. CONVERGED. Fixed: missing means ENOENT (any
  other failure to look is unreadable and never written over); the log remembers which kind of loss it said; the
  ordinary-save test goes through remote.fedSetStanding. The route comment records PigeonPete's measurement (row ids
  are device ids, byte for byte the session's device).
