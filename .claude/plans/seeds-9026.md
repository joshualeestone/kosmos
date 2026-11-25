# seeds-9026: the first Kosmos+ sign-in gate rotates seeds under Let's Encrypt's weekly limit (kosmos#9026)

**Posture:** production

**Finished looks like:** tools/plus-signin-auto.sh can be given several test seeds and uses the one used least this
week, so the gate is not limited to about five runs a week; with every seed used up it says so before any download,
naming when the next frees. With one seed it behaves as before.

## Why (measured on 11-24, from the card)
Each run registers the throwaway board under the seed's own Kosmos+ address, and the coordinator (relay
coordinator/src/macs.rs cert(), acme.rs: Let's Encrypt) orders a certificate for that exact name. Let's Encrypt allows
5 certificates for one name a week; the sixth run in an hour got HTTP 429 on /v1/mac/cert.

## Change
- tools/lib/plus-seed-ledger.js (new): pick(ledger, seeds) returns the seed with the fewest runs in the last 7 days
  under 5 (a tie goes to the order given), or { none, freesAtMs } (when the run keeping a full seed at five leaves the
  week); record(ledger, seed). The ledger is <recordDir>/seed-certs.jsonl (beside the gate's records). Unreadable or bad
  lines count as nothing (the worst case is the 429 the gate already reads as "cannot tell").
- tools/plus-signin-auto.sh: `--seed` may repeat; every seed passes the seed guard before any call; the ledger picks one;
  none left -> exit 2 before any download. A run is counted just before `finish` (the step that asks for the
  certificate), so one that dies after asking still counts.
- #9018 round 8: the listener refusal names a second listener beside the board instead of saying "not the board".
- #9018 round 9: KOSMOS_STORE_ROOT and KOSMOS_PLUS_VERIFIED_SHA256 are given only to the two plus-signin-fresh.js calls,
  no longer exported to every later child.

## Rejected
- A seed that owns no address (it registers as kseed-<sha8>, a new name each build): every run then spends Let's
  Encrypt's per-registered-domain weekly budget, which real users' new computers share.
- A coordinator-side exemption: the TLS key is made on the Mac and never leaves it, so the coordinator must order a
  certificate for each new key; reusing one would need the gate to keep its key across runs, which stops it testing a
  real first sign-in.

## Not done here, on purpose
- New dedicated seeds. All 22 existing test seeds already serve something else (live checks, walks, demo accounts), and
  sharing one spends its weekly allowance. Creating seed accounts on the production Kosmos+ (possibly a paid address)
  is for whoever owns the test accounts. Until then the callers pass the one seed and nothing changes for them.
- #9018 round 9's check-then-act on the progress file, and the sandboxed-versus-installed weighting (documented policy).

## Weakest premise
The ledger is per machine: runs of one seed from two machines are not counted together. The gate runs on the cut
machine, so in practice one ledger sees them.

## Tests
- tools.plus-signin-auto-9018.test.js: 17/17 (5 new: the second seed taken when the first is used up, and counted;
  every seed used up refuses before any call; week-old runs do not count; an unlisted second seed is refused; the
  ledger's arithmetic). With tools.plus-signin-2036.test.js: 46/46.
