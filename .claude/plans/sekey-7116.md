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
- test-support/se-p256-apple-vectors.json: 12 real Enclave signatures (9 high-S) over two pinned messages.
- engine/seadmin-7116.test.js; engine.reachable.test.js excuses for the five unwired exports.

## Decided
- **No keychain group, no signed app needed.** Measured 2026-11-03 on an unsigned swiftc build: create in one process,
  pub and sign in two later processes, from the 284-byte wrapped blob. The card's open question ("a persistent key may
  need a signed app") is answered no for CryptoKit's blob form. Rejected: SecKeyCreateRandomKey with kSecAttrIsPermanent,
  which needs a keychain-access-groups entitlement and a provisioning profile.
- **High-S is fine.** Apple signed high-S 9 times in 12 (an earlier count of 8, also posted on #7116, was my misreading of the generator's output; the file's flags were right). Measured with an offline build of p256 0.13.2 (relay's
  Cargo.lock) running verify_se's exact calls: all 12 verify, and each against the other message fails. roster.rs
  verify_se's doc already says high-S is accepted. The vector file is for the relay to pin as its
  SecKeyCreateSignature vector (roster.rs line ~510 asks for one).
- **devkeyhist-enrol/revoke left out**: agreed in prose on #7116, but escrowd has no encoder yet, so no pinned vector.

## Mutations (each in a copy, each red)
Swift fence removed; tag check removed; end() check removed; sign() skipping prepare(); encoder field order swapped.

## Not here (next slices)
- kosmos-se in tools/build-kosmos-bundle.sh (signed with the app), and the admin screen that calls this. Its gate: a
  presence key made from the app, signing called off the board's event loop, the prompt naming the action, and the
  helper path resolved by the app itself.
- devkeyhist rows once escrowd encodes them; the local signed-item log; head-read checks; the 4 h alarm.
- The relay test pinning se-p256-apple-vectors.json (a relay PR).

## Weakest premise
That a `presence` key (Touch ID or password on every signature, now createKey's default, because a key's access
control cannot be added after it is made) can be made from inside the app with a person at the screen. Measured only
the other way: from a tmux session it fails with errSecInteractionNotAllowed (-25308). If the app cannot make one
either, the admin screen slice has to find out why before any real admin key exists; a `none` key (custody = a 0600
file this user owns, refused otherwise) is what the tests use and is not acceptable for a real admin.

## Status
- [x] module, helper, tests (12/12 at round 3, Enclave arms not skipped on this Mac), engine.reachable 8/8
- [x] review round 1: presence policy at create (a key cannot gain one later), stated skips, key file mode/owner/symlink refusals, bounded stdin, sign checks its own result
- [x] review round 2: build/key failure FAILS Part 2 (only no-swiftc and no-Enclave skip); key read O_NOFOLLOW + fstat on the descriptor; fchmod against umask; directory fsync; distinct helper timeout. Deferred to the admin screen as a gate: async calls, LAContext reason on the prompt.
- [x] review round 3: sign() takes only prepare()'s own frozen result, so the signed bytes are the shown bytes; the vector test recomputes every high-S flag.
- [x] review round 4: the stand-in records the bytes it was handed (shown = signed on every machine); xcrun's reason in the skip. Deferred to the bundle/screen gate: resolving the helper path itself.
- [ ] challenge-loop, validation, PR
