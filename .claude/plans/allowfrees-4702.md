# allowfrees-4702: the Allow card says when Allow also frees a computer (kosmos#4702)

Follow-up from #4665 round 9. After #4665 a new computer is held until its registering sign-in (the lineage) is
allowed on the owner's older computer, so Allow on that sign-in also lets the new computer allow devices. The card said
nothing about it.

## Three layers, and who builds which
1. Coordinator (kosmos-relay, `GET /v1/mac/pending-devices`): mark a device that is a live Mac's registered device,
   `"registers_computer": "<mac name>"`. NOT built here: that handler is exactly what Ice Cream Kitty's #4665 is changing
   (it adds the `computer:<mac_id>` entries). Asked of her, in or after #4665.
2. Tunnel (kosmos-relay, crates/tunnel/src/devices.rs): `PendingDevice` rebuilds each device from fixed fields, so a
   new coordinator field is dropped there. Built on its own relay branch (allowfrees-4702): an optional
   `registers_computer`, passed through.
3. Board (this branch): engine/remote.js `pendingDevices` passes `registers_computer` (trimmed, capped at 60, null when
   absent or not a string), and the Allow card's sentence gains "Allowing this also lets the computer <name> allow
   devices." Escaped with askEsc; on the ask only, never on the Allowed or Denied lines.

Forward-compatible: until the coordinator sends the field, every request reads exactly as today.

## Decided
- snake_case `registers_computer` end to end, like device_id, first_seen and denied_at in the same snapshot.
- The sentence is added to the existing "Allow only if..." paragraph, not a new block: one card, one paragraph (#3829).

## Weakest premise
The card's own: that an owner allows a device without realising it registered a computer. The in-app sign-in and
register happen together, so the owner is often the one who just did it; the sentence costs one line either way.

## Proof
- engine/remote.test.js: passed through trimmed and capped; absent, blank or not a string is null (the control).
- web.allow-card.test.js: the sentence is built with askEsc, sits in the ask paragraph, and is absent from the
  Allowed / Denied branches.
- render-plus-panel-3829 (browser): the `two` state's iPhone carries `registers_computer: 'Kitchen <b>Mac</b>'`; the
  card says the sentence once with the markup shown as text; the `one` state (no field) says nothing (control).
- Controls on the real code: dropping `+ frees` from the card, or the engine pass-through, each turns a test red.
