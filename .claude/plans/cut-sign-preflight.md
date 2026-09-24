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
- `tools/release.sh`: new step 1c, after the versions-entry gate and before step 2's bump,
  so a machine-only refusal mutates nothing (no pushed bump).
- `tools.release-gate.test.js`: its sandbox holds no cert, so `run_git` sets
  `KOSMOS_CODESIGN_BIN=true` (the builtin) for the arms that must reach step 2. Control:
  with `false` instead, exactly the 3 reach-step-2 arms go red, so they run through 1c.
- `tools/test-cut-sign-preflight.sh`: arms driven by function stubs (no fresh executables,
  which stall exec on some Macs), an identity drift check and a wiring-order check. Wired
  into `test:shell`.
- `docs/releasing.md`: step 1c, the unlock commands, and the rule that the unlock must be in
  the session that runs the cut (an unlock did not reach a nohup-detached cut on 09-24).

## Rejected
- After the freeze (the first draft): a refusal there leaves a pushed bump for a version
  that never shipped. Review iteration 1 showed the release-gate conflict was a test seam,
  not a placement constraint.
- Auto-unlocking in release.sh: needs the login password in the cut. The operator unlocks,
  and the preflight says how.
- Probing productsign separately: same login keychain, so one probe finds the lock. A
  missing or expired Installer cert is not probed (stated in the lib header).

- Recommending `security set-keychain-settings` in the remedy (review iterations 3-4):
  with no arguments it removes the auto-lock for good, and with `-t` it still leaves a
  lasting posture change on a signing box with nothing to revert it. Mortals reads
  `no-timeout` (measured 09-24 from an unlocked session), so an unlock in the live cut
  session is enough. The remedy is unlock-only. The same reasoning drops
  `set-key-partition-list` (review iteration 5): it permanently rewrites the key's
  access list.

## Weakest premise
That the failure strings (`errSecInternalComponent`, "User interaction is not allowed")
are stable. If they change, the preflight still refuses, but with the generic message.

Second: that the signing box's login keychain has no idle timeout. If one is set shorter
than a cut, the keychain can re-lock mid-cut and step 4 fails the old way; the 1c probe
passes at the start and cannot see that.

## Proof
- Agent1s (GUI session): real codesign, rc=0.
- Mortals over SSH: real errSecInternalComponent, the lock message, rc=1.
- Injecting `return 0` in place of the final refusal: 4 arms red.
