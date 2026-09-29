# plusasks-4610: Kosmos+ first sign-in (Josh 12:50, new account in the Mac app)

Card: joshualeestone/kosmos#4610 (priority; Splinter's calls on the card; Josh ruled on problem 3 at 13:00).

## 1. Placement (done)
On Kosmos Plus the device requests always render in #plus-asks, in the Plus section, in every state (sign-in wizard
included). Before: only while the connected panel (#plus-flow) showed; right after sign-in it was hidden, so the cards
went into the top card (#askcard), a band across the whole window. Elsewhere the top card stays the one-line notice.
New gated check render-plus-asks-signin-4610 (fails on the old rule: 3 FAILs, the band).

## 2. "Old requests on a new account" (board-side gap fixed; the rest is a finding)
Requests are per account at the coordinator (pending_devices(account_id, mac_id)). The board's gap: pending.json is
the old tunnel's last snapshot and survived a new sign-in until the new tunnel's first successful poll. Now removed at
every identity change (setupComplete, cancelledAfter, signinRegister), after the old tunnel stops.
Finding (inferred from code, not checked against production data): "Mac · Safari, 14 minutes ago" is most likely
Josh's own signup of the NEW account in Safari: every session, the web signup included, is a device at the coordinator
(issue_session -> upsert_device). If a web signup should not ask to use the Mac until the person opens it from the web,
that is a coordinator change (kosmos-relay), carried on the follow-up card.

## 3. This computer (Kosmos app) asked to approve itself (done, Josh's ruling 13:00)
Josh: "should get auto-approved instantaneously behind the scenes and never display to the user." This Mac's own
in-app sign-in is a device row that registering never grants. Now: never listed (pendingDevices), and granted through
the same Allow the person's button uses (deviceAllow) right after sign-in, and retried from the supervisor's 15s tick
(ensure) while the running tunnel's snapshot still lists it (once a minute at most, never two at once); that also
grants a Mac signed in before this change. Not from pendingDevices, which every open board reads every 5s and must
never spawn (a test holds it, and fails with the call put back there). Scoped by remote.json's device_id, which this board minted for its own
sign-in and never takes from a request: a device that only calls itself "This computer (Kosmos app)" is shown and
never granted (tested).

## Connect took 30s+ (finding, relay)
A new address needs a certificate, and the coordinator's ACME step sleeps a FIXED dns_wait, default 30s
(kosmos-relay coordinator main.rs KOSMOS_ACME_DNS_WAIT, acme.rs), before polling; engine comments measured 65s on
production 2026-09-25. Re-signing in with the same name skips it. Follow-up card for the relay owners.

## Weakest premise
The Safari row's origin (inferred, not measured on production). And the grant is keyed by device_id: a
coordinator grant is per (account, device_id, Mac), so a device that could sign in to the account presenting this
Mac's device_id would inherit the grant. The id is a random UUID minted here and shown only to the page (which
remote viewers see only once already allowed); whether the coordinator binds a device id to anything more is a
kosmos-relay question, the same one that applies to every device the person has already allowed.

## Blind review round 1 (a separate reviewer agent, 2026-09-29 13:22) and what changed
The earlier "review round" on this branch was the loop's own; this is the first separate reviewer.
- The stranger test could not fail (it never went through the one granting path, ensure()). New test drives the tick
  with this Mac and a stranger in one snapshot; granting everything in the snapshot turns it red (measured).
- A grant that succeeded is not re-spawned while a stale snapshot still lists it; a grant that fails is logged once per
  id. Both reset on a new identity.
- Josh: "never display". This Mac is also left out of the ALLOWED list (it carried a Remove the grant would undo), and
  the board no longer sends its device id to the page at all (the page's #3829 relabel is removed with it).
- abandonChangedIdentity (a failed register that kept a new mac_id) drops the stale snapshot too.
Weakest premise, carried to #4616: at the coordinator a device id is whatever a signing-in client presents; a client
with the account's credentials that presents this Mac's id would now be granted without a person's Allow. The id is
never on a read route any more, which narrows who can learn it.

## Blind review round 2 (Sonnet, a separate reviewer, 2026-09-29 13:37) and what changed
- A grant still out when the identity changed could land and mark the NEXT identity granted (device_id survives a
  Forget by design), so that Mac was never granted. Now an epoch bumped by every identity change; an answer counts only
  for its own epoch (tested with a slowed fake grant; removing the epoch check fails it).
- The "granted" mark is reset at every identity change (all four sites, through forgetPendingSnapshot) and a reported
  success is re-tried if the id is still pending ten minutes later.
- The pre-change-Mac test raced two grant sources; now it has only the tick. A stranger arm that only read the snapshot
  (and so could not fail) is removed; the tick test holds that case.
Kept, stated: this Mac is filtered from Allowed by its id, which a client on the same account could present (#4616).
