# sekey-7116: #7116 slice 4, the Mac half: an se-p256 admin key in the Secure Enclave, and what it may sign

Card: joshualeestone/kosmos#7116. escrowd half: kosmos-relay `.claude/plans/reviewpage-5686.md` (Renet, on relay main).

## Goal
The Mac can hold an escrowd roster admin key of type `se-p256` in its Secure Enclave and sign exactly the four admin
actions escrowd has pinned bytes for, under the plan's client rule: decode every byte and check the tag is the chosen
action; show the decoded target and fingerprint; compute the challenge itself; never sign a hash or opaque blob.

## Scope (this branch)
- native-se/main.swift (`kosmos-se create|pub|sign <keyfile>`): CryptoKit SecureEnclave.P256.Signing, message mode,
  DER out. Key file is the Enclave-wrapped dataRepresentation, O_EXCL + 0600. Its own tag fence (second line).
- engine/seadmin.js: encoders/decoders ported from relay console-bundle/roster-bytes.js; prepare(); sign(); createKey();
  publicKey(). Nothing calls it yet.
- test-support/escrowd-roster-vectors.json (relay e094b8bed console-bundle/vectors.json, unchanged).
- test-support/se-p256-apple-vectors.json: 12 real Enclave signatures (8 high-S) over two pinned messages.
- engine/seadmin-7116.test.js; engine.reachable.test.js excuses for the five unwired exports.

## Decided
- **No keychain group, no signed app needed.** Measured 2026-11-03 on an unsigned swiftc build: create in one process,
  pub and sign in two later processes, from the 284-byte wrapped blob. The card's open question ("a persistent key may
  need a signed app") is answered no for CryptoKit's blob form. Rejected: SecKeyCreateRandomKey with kSecAttrIsPermanent,
  which needs a keychain-access-groups entitlement and a provisioning profile.
- **High-S is fine.** Apple signed high-S 8 times in 12. Measured with an offline build of p256 0.13.2 (relay's
  Cargo.lock) running verify_se's exact calls: all 12 verify, and each against the other message fails. roster.rs
  verify_se's doc already says high-S is accepted. The vector file is for the relay to pin as its
  SecKeyCreateSignature vector (roster.rs line ~510 asks for one).
- **devkeyhist-enrol/revoke left out**: agreed in prose on #7116, but escrowd has no encoder yet, so no pinned vector.

## Mutations (each in a copy, each red)
Swift fence removed; tag check removed; end() check removed; sign() skipping prepare(); encoder field order swapped.

## Not here (next slices)
- kosmos-se in tools/build-kosmos-bundle.sh (signed with the app), and the admin screen that calls this.
- devkeyhist rows once escrowd encodes them; the local signed-item log; head-read checks; the 4 h alarm.
- The relay test pinning se-p256-apple-vectors.json (a relay PR).

## Weakest premise
That a file readable only by this user is enough custody for the wrapped blob. The Enclave stops the key leaving this
Mac, not another program running as this user from asking it to sign. A biometric or passcode access-control flag
(SecAccessControl .userPresence) would close that, and needs a person at the Mac for every signature, which is right
for roster changes and is the first thing to add with the admin screen.

## Status
- [x] module, helper, tests (7/7, Enclave arms not skipped on this Mac), engine.reachable 8/8
- [ ] challenge-loop, validation, PR
