# kosmos#7568: a cut refuses a service key set that lacks the live coordinator key

## Why
Since #7561 a Kosmos Cloud box pins the coordinator keys the release ships (engine/service-keys.json, staged by
tools/lib/stage-service-keys.sh), and a Mac's connector is handed the same list. 0.7.74 ships no set. The first cut
that ships one is the risk: a set without the live key stops every new cloud box joining and every sign-in.

## Done when (from the card)
The cut refuses to publish a set that lacks the live coordinator key (/v1/meta coordinator_pubkey): red with a set
that lacks it, green with one that has it.

## The call
- **Where:** release.sh step 1d3, beside 1d2 (coordinator floor), before the bump. A refusal costs a fix, not a cut.
  And again on the FROZEN tree right after step 2b, beside the #6149 installer re-check: the shared checkout can be
  fast-forwarded between step 1 and the freeze, which could bring in or change a set after 1d3 asked nothing.
- **What:** tools/lib/service-keys-live.sh `service_keys_live_check <repo>`: no engine/service-keys.json, nothing is
  asked; otherwise curl /v1/meta (same URL, retries and env as coordinator-floor.sh) and pipe it to
  tools/check-service-keys-live.js, which compares with engine/servicekeys.js pinnedIsListed, the board's own test.
- **Fails closed, no override:** unreadable meta, no key, junk key, junk set. No legitimate set omits the key in use
  (a rotation lists next BESIDE current).
- **Keys read from the set's JSON, not a verified set,** so the check answers while no recovery key is pinned; whether
  the set verifies is step 4's staging check.

## Rejected
- Checking in stage-service-keys.sh: it also runs from deploy/install-board.sh (a dev install), which must not need
  the network or the live service.
- Checking at promote-channel.sh: the card names the cut; a promote days later could also see a rotated key. Not
  done here; noted on the card.
- An override env var: no case found where shipping without the live key is right.

## Weakest premise
A refusal at the frozen re-check comes after step 2's bump is pushed (the same stated limit as #6149's re-check).
The live coordinator is the one installs use (KOSMOS_COORDINATOR_URL default, login.kosmosplus.com). A key rotation
between this check and step 8's publish is not seen; the cut runs minutes, rotations are planned.

## Tests
tools/test-service-keys-live-7568.sh (in test:shell): no set passes without asking (control: meta absent); a set
without the key refuses, naming it; with it, alone or beside another, passes; five fail-closed arms; release.sh runs
it before the bump and again between the freeze and step 4. tools.release-gate.test.js runs the real release.sh in a
git sandbox: a set without the key refuses at 1d3 with the version untouched, the same sandbox with the key reaches
step 2. Mutant runs and the live-service red/green runs are by hand; their output is in the PR body.
