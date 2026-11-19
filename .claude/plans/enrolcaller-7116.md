# enrolcaller-7116: the caller of a device-key enrolment on this Mac (kosmos#7116 step 2, caller)

Stacked on enrolclient-7116 (the signer). Splinter 14:26: step 2 is mine end to end; the enrolment flow only (a board route, the admin screen's section, kosmos-se from the bundle); #7892's roster-change and reviewer screens stay with Kitty.

## Finished looks like
A McKinney admin on their own Mac sees each computer waiting for their approval (who, K's fingerprint, whether this Mac checked the invite code), approves it with Touch ID, and the signature reaches escrowd. The inviting admin's Mac keeps the join code from the invite until then, and refuses to sign as inviter without it.

## Slice 1 (this branch so far)
- engine/enrolsign.js: kosmos-se found only as a plain executable in the app's own bin; the inviter's join codes kept owner-only (0600), keyed by company and member (JSON key, no separator collisions), expiring after 30 days, dropped once escrowd accepts (see State after review); review() prepares with the kept code for the DECODED company and member; approve() signs with this app's helper.
- Tests: engine/enrolsign-7116.test.js (a stand-in helper with a P-256 key; the real kosmos-se is covered by seadmin-7116).

## Blocked, asked on #7116 (comment 7021307518)
- Step 1's two coordinator routes (list the enrolments waiting on this admin; post a signature), and the submission's wire format.
- Where invites that enrol a Mac are made (the Mac app, which keeps the code; or the console). Recommended: the Mac app, for the pilot.
- Shipping kosmos-se in the bundle: release tooling (Baron); asked before touching tools/build-kosmos-bundle.sh and its checks.
- Gate 6 (a presence key made in the app with a person at the screen): a people step, written on #7116 for Josh's batch.

## Weakest premise
That this Mac's admin id and enrolled Enclave key are known to the board at sign time. Nothing stores them yet; they come with the admin-key creation flow (#7892 gate 6) or from the coordinator's roster.

## State after review (5 rounds, converged 15:3x 11-19)
- Slices 1-3 built: helper path, kept codes, review/approve/approveAndSend, the route client (startAndSign, pending, postAdminSig), adminQueue.
- The kept code: tied to one computer's key in approve() before signing; the tie lasts one hour (an entry lives 30 minutes); dropped when escrowd accepts and the kept code is still the one checked. One invite enrols one computer.
- Step 1's routes are no longer blocked: Renet pinned them (#7116 comment 7021733967). Still waiting: where invites are made (the screen).

## Rounds 6 and 7 (after rebase onto main, 11-19 16:4x)
- Round 0 for these: Renet's corrected routes (all POST, fixed paths, id in the body, pending POST {}); `ended` worked out from the code (the tunnel drops the field on an error answer).
- Round 6: a refused sign carries the entry id and expiresAt; `ended` only on sign calls, undefined when no code came back; every stays/ends code tested.
- Round 7: a kept code applies only to the entry whose codeHash it hashes to, so another admin's invite for the same member is offered as a second admin; a tie's hour is checked before its other-computer refusal; approve() re-checks an unchecked entry against the store; the review-5 accept guard is tested; remote.busy()'s fixed sentences are shown.
