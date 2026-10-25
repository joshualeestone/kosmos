# devkeyhist-7116: #7116 slice 1, the device-key history format and its check

Card: joshualeestone/kosmos#7116 (design v2: comment 6397107294).

## Goal
The Mac-side format and verifier for escrowd's signed per-member device-key history, so a later restore (slice 3) can
take a snapshot's signing key from escrowd's word instead of the coordinator's.

## Scope (this branch)
- engine/devkeyhist.js: encodeHead (hash chain over enrol/revoke entries; head = tag, org, member, count, issuedAt,
  chain), verify (signature, freshness, skew, replayed log rules), keyAt (window lookup).
- Fails CLOSED when no verifying key ships (VERIFYING_KEY null refuses), unlike orgkeypin.js.
- engine/devkeyhist-7116.test.js: each refusal beside a passing twin; head format pinned by hash for the relay side.
- engine.reachable.test.js: keyAt excused, naming slice 3.

## Out of scope
- escrowd's store and signer (slice 2, kosmos-relay), wiring restore (slice 3), approval keys and roster (slice 4),
  seeding (slice 5).

## Status
- [x] module and tests; hand mutations, each caught by its own test
- [x] engine.reachable passes with the excuse
- [ ] challenge-loop
- [ ] push and PR after the Mortals hold lifts

## Carried to slice 3 (wiring restore)
- verify() reads the Mac's own clock when no `now` is passed, so a Mac with its clock rolled back accepts a head that
  much older. Slice 3 passes the most trustworthy time it has, never a time taken from the manifest.
- There is deliberately no option for the verifying key; slice 3 must not add one.
