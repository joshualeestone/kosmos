# pkgsig-6474: the .pkg postinstall holds the installer to the signed release on an existing install (#6474)

Stacked on setupsig-6468 (#6475; needs run-setup), on manifestsig-6468 (#6472).

## Finished looks like
Opening the .pkg on a Mac that already has Kosmos at the default home, with a verifier that knows run-setup, never runs
the site installer unless it matches the signed manifest of the version prod serves; a mismatch runs nothing.

## Decided
- Option 1 of the card: hand off to the INSTALLED copy's run-setup (it re-downloads, checks, runs). The checksum gate
  stays in front of it unchanged.
- Option 2 (a first install, no installed copy) NOT built: measured, the system /usr/bin/openssl is LibreSSL 3.3.6 and
  cannot verify a raw ed25519 signature (pkeyutl has no -rawin), and the pkg has no node before the bundle lands. A
  first install keeps the checksum (the .pkg itself is notarized). The way to close it is a native check in the
  notarized app (CryptoKit Curve25519.Signing); left on the card.
- Only the DEFAULT home ($HOME/.local/share/kosmos), as the pkg installs. An installed verifier from before ask 3
  (no run-setup) keeps the checksum path, by the grep, so a pkg reopened over an older install does not break.

## Done
- install/pkg-scripts/postinstall: the hand-off, apostrophe-free inside the single-quoted block.
- tools/test-pkg-checksum-1670.sh: HOME sandboxed for every arm (it inherited the real one); ARMS 5a (signed match
  runs), 5b (checksum matches but the signed release names other bytes: not run), 5c CONTROL (no verifier: the
  checksum path runs). A mutant disabling the hand-off turns 5b red.
- test-postinstall-inline-quoting, test-resolve-install-user, test-install-page-readable-3268 pass.

## Not run
A real .pkg install (needs a built, notarized pkg).

## Review log
### Iteration 1 (sonnet): 0 BLOCKERs, 1 should-fix
- [WARNING] the hand-off had no retry, regressing the 2026-09-15 half-publish hardening (FIXED: a 97 is retried on the same bounded _rmax/_rsleep budget; any other status is the answer)
- [NIT] a broken installed node blocked the repair path (FIXED: a node -e 0 health probe in the gate falls back to the checksum path)
- [NIT] the refusal said "kosmos update:" to a .pkg user (FIXED on the base branch: messages say Kosmos)
