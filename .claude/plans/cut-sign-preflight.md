# cut-sign-preflight (#3579)

## Problem
Step 4 of `tools/release.sh` Developer ID signs the connector and the native app. Over a
plain SSH session (Mortals) the login keychain is locked, so codesign fails with
`errSecInternalComponent` after the ~22 minute suite and page layer. A cut does not resume.

## Change
- `tools/lib/cut-sign-preflight.sh`: `kosmos_sign_preflight` test-signs a temp copy of
  `/usr/bin/true` with the cut's identity (`KOSMOS_CODESIGN_ID` or the same default as
  `build-kosmos-bundle.sh`), `--timestamp=none`. It classifies a failure as locked
  keychain, missing identity or unrecognised. Every failure refuses, with codesign's own
  output shown first.
- `tools/release.sh`: new step 2c, sourced and called after the freeze and before the
  gated steps. It sits after step 2 because `tools.release-gate.test.js` drives a sandbox
  to step 2 with no signing identity.
- `tools/test-cut-sign-preflight.sh`: 17 arms with function stubs (no fresh executables,
  which stall exec on some Macs), an identity drift check and a wiring-order check. Wired
  into `test:shell`.
- `docs/releasing.md`: step 2c and the unlock commands.

## Rejected
- Before step 2: breaks the release-gate positive controls on any box without the cert.
- Auto-unlocking in release.sh: needs the login password in the cut. The operator unlocks,
  and the preflight says how.
- Probing productsign separately: same login keychain, so one probe finds the lock.

## Weakest premise
That the failure strings (`errSecInternalComponent`, "User interaction is not allowed")
are stable. If they change, the preflight still refuses, but with the generic message.

## Proof
- Agent1s (GUI session): real codesign, rc=0.
- Mortals over SSH: real errSecInternalComponent, the lock message, rc=1.
- Injecting `return 0` in place of the final refusal: 4 arms red.
