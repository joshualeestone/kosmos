# recoverykey2-6609: the in-app update takes the release key list first (#6609 phase 2a)

Card: kosmos#6609 (detail private). Phase 1 is #6618 (merged): verifyKeyList, storedKeyList, trustedKeys, inert. Phase plan: `.claude/plans/recoverykey-6609.md` "Phase 2".

## Finished looks like (this slice)
With a recovery key pinned, `run-setup` (the in-app update and `kosmos update`) fetches `<release base>/release-keys.json` and its `.sig`, takes the list through trustedKeys (this copy's record, so an older list cannot come back), and checks the installer's manifest with the list's keys, not the built-in ones. No list: no update (96, not fetched). A list that does not check out: refused (97). Off as shipped (RECOVERY_KEYS empty): nothing more is fetched and nothing changes.

## Decided
- **The list lives at the release base** (`<base>/release-keys.json`, beside the manifests), the URL the rest of phase 2 must serve. Rejected: a URL of its own (a second thing to configure and to drift).
- **"List first" is about the checks, not the downloads.** The installer is never run before the manifest is checked with the list's keys; downloading the installer before or after the list makes no difference to that (a mutant that downloads it first stays green, and that is correct).
- **Exit codes.** A list that cannot be downloaded or read, a list that does not verify, and a list another check recorded a newer one meanwhile are 96 (retried): the list and its signature sit at one address that changes with every list and are fetched as two files, so a cache or a publish in progress can hand back a torn pair, which looks exactly like a bad signature (review 1). A list that verifies but is refused (older than this copy's record, or other keys at a seq already taken) is 97: a retry gives the same answer. Both list downloads carry one fresh random query per attempt over http(s), so a retry is not answered from the same stale cache entry (the installer's version-keyed buster would be). Not on file://.
- **The run-setup interface is unchanged** (its arguments and exit codes are frozen, #6474); no caller passes keys.
- Rest of phase 2, not here: setup.sh's own manifest checks and the .pkg helper (2b), serving the list from the site and refusing a cut whose signing key the served list does not name (2c), freshness (expiry), raising MIN_KEY_LIST_SEQ after a revocation, and activation.

## Weakest premise, and the rule it makes
This slice alone stops nothing against someone who holds a stolen release key and controls what the site serves. run-setup checks the installer's manifest with the list's keys, but setup.sh then downloads the manifest again and checks the tarball with the INSTALLED copy's verifier in its plain form (update_manifest_ok, update_tmux_ok), which uses the built-in KEYS and never the list. So that attacker serves run-setup a genuine release and setup.sh a same-version manifest signed by the stolen key, and the tarball installs (review 1 found this; the first version of this paragraph wrongly said setup.sh uses the NEW release's verifier). It also breaks rotation: a release signed by a key only the list names passes run-setup and is refused by setup.sh.
**Rule: RECOVERY_KEYS is not filled in before phase 2b wires setup.sh's checks to the list.** Stated beside RECOVERY_KEYS in engine/manifest-verify.js; the test pinning it empty stays.

## Validation
- install.recoverykey-run-setup-6609.test.js (8): end to end over file://, with throwaway release, other and recovery keys rewritten into an installed copy. Mutants measured red: the list's keys not passed (1), the list skipped (5), a refused list ignored (2).
- install.setup-sig-6468.test.js, engine/manifest-verify.recovery-6609.test.js, engine.reachable.test.js unchanged and passing (41 with the new file). engine.reachable's trustedKeys excuse text corrected: runSetup now calls it.

## Review log
### Iteration 1 (opus)
- [WARNING] fixed: a torn or cached list/signature pair, and the "taken meanwhile" race, answered 97 (permanent; the .pkg path does not retry it) when a retry would succeed. Now 96, with a fresh shared query per attempt over http(s); a verified-but-refused list stays 97. Arms: a list from the wrong signer and a torn pair are 96; the https query is on both files and changes per attempt, none on file://; trustedKeys's race result carries retry: true (phase-1 race test). Mutants measured red: the signature failure back to 97 (2), no query (1), different queries (1), a fixed query (1), the retry flag removed (1). Not reachable end to end: runSetup's use of the retry flag (the race needs the phase-1 linkSync stand-in), stated rather than faked.
- [WARNING] fixed: the weakest premise named the wrong mechanism. setup.sh checks with the INSTALLED copy's built-in KEYS, so this slice alone stops nothing. Rule written beside RECOVERY_KEYS and in the plan: not filled in before phase 2b.
- [NIT] recorded for activation: a refused rollback reaches update.js as the generic 97 "could not be checked, try again" sentence; it is an attack signal and deserves its own words when activation is documented.
