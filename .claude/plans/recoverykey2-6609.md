# recoverykey2-6609: the in-app update takes the release key list first (#6609 phase 2a)

Card: kosmos#6609 (detail private). Phase 1 is #6618 (merged): verifyKeyList, storedKeyList, trustedKeys, inert. Phase plan: `.claude/plans/recoverykey-6609.md` "Phase 2".

## Finished looks like (this slice)
With a recovery key pinned, `run-setup` (the in-app update and `kosmos update`) fetches `<release base>/release-keys.json` and its `.sig`, takes the list through trustedKeys (this copy's record, so an older list cannot come back), and checks the installer's manifest with the list's keys, not the built-in ones. No list: no update (96, not fetched). A list that does not check out: refused (97). Off as shipped (RECOVERY_KEYS empty): nothing more is fetched and nothing changes.

## Decided
- **The list lives at the release base** (`<base>/release-keys.json`, beside the manifests), the URL the rest of phase 2 must serve. Rejected: a URL of its own (a second thing to configure and to drift).
- **"List first" is about the checks, not the downloads.** The installer is never run before the manifest is checked with the list's keys; downloading the installer before or after the list makes no difference to that (a mutant that downloads it first stays green, and that is correct).
- **A download failure of the list is 96 (a retry can succeed), a list that does not check out is 97**, the existing split.
- **The run-setup interface is unchanged** (its arguments and exit codes are frozen, #6474); no caller passes keys.
- Rest of phase 2, not here: setup.sh's own manifest checks and the .pkg helper (2b), serving the list from the site and refusing a cut whose signing key the served list does not name (2c), freshness (expiry), raising MIN_KEY_LIST_SEQ after a revocation, and activation.

## Weakest premise
That the installed copy's run-setup is the gate for every update. setup.sh, once running, checks the tarball with the NEW release's own verifier (the KEYS it carries), which a release signed with a stolen key controls; that is phase 2b's job. Until 2b, phase 2a alone stops a stolen key only where run-setup refuses the installer.

## Validation
- install.recoverykey-run-setup-6609.test.js (6): end to end over file://, with throwaway release, other and recovery keys rewritten into an installed copy. Mutants measured red: the list's keys not passed (1), the list skipped (5), a refused list ignored (2).
- install.setup-sig-6468.test.js, engine/manifest-verify.recovery-6609.test.js, engine.reachable.test.js unchanged and passing (41 with the new file). engine.reachable's trustedKeys excuse text corrected: runSetup now calls it.

## Review log
