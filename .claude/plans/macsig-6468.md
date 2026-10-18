# macsig-6468: the Mac updater checks the new build's signer (#6468 ask 1)

## Finished looks like
A downloaded Mac update whose Kosmos.app, runtime/bin/node, kosmos-tunnel or kosmos-app is not signed like the
installed copy is refused before anything in it runs, and the old install stays as it was.

## Done
- install/setup.sh `update_signer_ok`: each part must satisfy the INSTALLED part's designated requirement
  (identifier + team, read from the installed copy; node is Node's own team, the rest are ours). Ad-hoc or unsigned
  installed parts are not held to a signer and say so. Called in install_kosmos on the downloaded path, macOS only,
  before the new runtime's --version probe.
- install.update-signer-6468.test.js: 7 arms (control accepted; re-signed, different identifier, unsigned, symlinked
  refused; ad-hoc install not held; call site before the probe and on the network path only).

## Verified
- 7/7; mutant with the refusal removed: 4 fail. The 30 test files that read setup.sh: 471/471.
- Live, against this Mac's real Developer ID install: a copy of itself accepted; an ad-hoc re-signed kosmos-app refused.

## Not run
- A real update end to end through the site (CI and the next release walk cover it).

## Limits (stated on the card)
- Guards signed binaries only; app/ JS and bin/kosmos need ask 2's signed manifest.
- The check is only as trusted as the setup.sh that runs it, which today is fetched from the site (ask 3).
