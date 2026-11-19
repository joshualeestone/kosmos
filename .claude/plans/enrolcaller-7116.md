# enrolcaller-7116: the caller of a device-key enrolment on this Mac (kosmos#7116 step 2, caller)

Stacked on enrolclient-7116 (the signer). Splinter 14:26: step 2 is mine end to end; the enrolment flow only (a board route, the admin screen's section, kosmos-se from the bundle); #7892's roster-change and reviewer screens stay with Kitty.

## Finished looks like
A McKinney admin on their own Mac sees each computer waiting for their approval (who, K's fingerprint, whether this Mac checked the invite code), approves it with Touch ID, and the signature reaches escrowd. The inviting admin's Mac keeps the join code from the invite until then, and refuses to sign as inviter without it.

## Slice 1 (this branch so far)
- engine/enrolsign.js: kosmos-se found only as a plain executable in the app's own bin; the inviter's join codes kept owner-only (0600), keyed by company and member (JSON key, no separator collisions), expiring after 30 days, dropped once signed; review() prepares with the kept code for the DECODED company and member; approve() signs with this app's helper.
- Tests: engine/enrolsign-7116.test.js (a stand-in helper with a P-256 key; the real kosmos-se is covered by seadmin-7116).

## Blocked, asked on #7116 (comment 7021307518)
- Step 1's two coordinator routes (list the enrolments waiting on this admin; post a signature), and the submission's wire format.
- Where invites that enrol a Mac are made (the Mac app, which keeps the code; or the console). Recommended: the Mac app, for the pilot.
- Shipping kosmos-se in the bundle: release tooling (Baron); asked before touching tools/build-kosmos-bundle.sh and its checks.
- Gate 6 (a presence key made in the app with a person at the screen): a people step, written on #7116 for Josh's batch.

## Weakest premise
That this Mac's admin id and enrolled Enclave key are known to the board at sign time. Nothing stores them yet; they come with the admin-key creation flow (#7892 gate 6) or from the coordinator's roster.
