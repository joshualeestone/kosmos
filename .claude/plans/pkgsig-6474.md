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
### Iteration 2 (opus): 0 BLOCKERs, 5 should-fix
- [WARNING] a rollback, or a Mac newer than the site offers, retried a deterministic "older than installed" refusal
  (DECIDED: a .pkg does not take a Mac backwards, which is what keeps a site from downgrading it to an old signed
  release; it now stops at once with a .pkg sentence that says nothing needed doing)
- [WARNING] an unreadable installed package.json blocked the repair path (FIXED: the gate also needs a readable
  version; arm 5f)
- [WARNING] every refusal was 97, so a real mismatch was retried (FIXED: run-setup returns 96 for a failed download
  on the base branch; only 96 is retried; 97 ends with one sentence; arms 5d, 5g, and 5b asserts no retry)
- [WARNING] run-setup's command line is now relied on by shipped .pkgs (FIXED on the base branch: marked frozen; the
  .pkg arms call it in that exact shape)
- [WARNING] retry and health probe untested, 5a weak (FIXED: 5d retry recovers, 5g persistent 96, 5e broken node,
  5f unreadable version; 5a asserts the hand-off ran). Writing them exposed that 5b had been refused on a BAD
  SIGNATURE (the edited manifest was never re-signed), not on the installer mismatch it claims: it now re-signs with
  the pinned throwaway key and asserts the exact mismatch sentence.
- [NIT] curl timeout added; greedy version sed and the outer "did not complete" line (ACCEPTED)
- Mutants: retry removed (5d, 5g red), node probe removed (5e red), version check removed (5f red).
