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
