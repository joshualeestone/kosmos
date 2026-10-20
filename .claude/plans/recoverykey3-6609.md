# recoverykey3-6609: the installer's own checks use the release key list (#6609 phase 2b)

Card: kosmos#6609 (detail private). Stacked on recoverykey2-6609 (phase 2a, PR #6687: run-setup takes the list first). Phase plan: `.claude/plans/recoverykey-6609.md`.

## Finished looks like (this slice)
With a recovery key pinned, an update cannot be installed by a release whose signing key the newest release key list dropped, on any step setup.sh checks: the manifest (early and pre), the terminal manager (tmux), and the files (post). setup.sh fetches the list beside the manifest and hands it to the INSTALLED copy's verifier, which takes it through trustedKeys and checks with its keys. Off as shipped: nothing more is fetched and nothing changes.

## Why this slice exists
Phase 2a's review found that 2a alone stops nothing: setup.sh downloads the manifest again and checked it with the installed copy's plain form, which used the built-in KEYS. A site under an attacker's control, with a stolen release key, served run-setup a genuine release and setup.sh a manifest signed by the stolen key. The "THE ATTACK" arm in install.recoverykey-setup-6609.test.js is that case, refused here, with the off control installing it.

## Decided
- **The list reaches the verifier by environment** (KOSMOS_KEY_LIST, KOSMOS_KEY_LIST_SIG), not new arguments: the plain and tmux argument shapes are called by installers already published and stay as they are.
- **The installer asks before fetching.** A new capability word, `keylist`, plus a `needs-key-list` form (exit 0 only when a recovery key is pinned). An installed copy that does not list it, or says no, gets no extra download, so shipping this cannot break any update while the list is not yet served (phase 2c serves it).
- **On, with no list handed in, the verifier refuses** (not "falls back to KEYS"): an older installer that does not fetch the list must not install past a revocation. Rejected: falling back to the built-in keys, which is the hole.
- **One fresh query per attempt over http(s), shared by both files** (as 2a), from /dev/urandom via od; none on file://.
- **The list is fetched once per attempt** (with the manifest, at early, or at pre when early was skipped) and the same files go to tmux, pre and post; trustedKeys runs on each step and is idempotent at a seq already recorded. A list published mid-run is not seen until the next attempt; a newer list recorded meanwhile by another check refuses this one (review 1 corrected the first wording, which claimed a mid-run list was taken).

## Weakest premise, and the hard gate
The .pkg installer's pinned path (install/pkg-scripts/postinstall, #6576) chooses the installer with kosmos-pkg-verify, a Swift helper with the release keys compiled in, then runs it. A revoked key can therefore still open a .pkg install: a genuine older .pkg accepts a manifest signed by that key naming the attacker's setup.sh, which leaves 2b's checks out (review 1). Rotation breaks there too. **Hard gate, written beside RECOVERY_KEYS: it stays empty until the .pkg helper takes the list and the site serves it (2c).** A first install (no installed copy) and `curl | sh` over an install have no anchor and are outside this scheme; Linux has no signed check. **Windows** (engine/win32update.js, #6607, merged 04:34) now checks its manifest with the built-in KEYS, so it is a third gate, added to the rule beside RECOVERY_KEYS at Splinter's 05:07 check.

## Validation
- install.recoverykey-setup-6609.test.js (6, early, tmux, pre and post): the real setup.sh functions under /bin/sh against an installed copy with throwaway keys. Mutants measured red: no list handed to the verifier (2), the verifier ignoring the list (4), the installer always fetching (1), a missing list falling back to KEYS (1), the tmux form using KEYS (1).
- All 32 install.*.test.js plus engine/manifest-verify.recovery-6609 and engine.reachable: 356 pass, 0 fail, 0 skipped.

## Review log
### Iteration 1 (opus)
- [WARNING] fixed: the rule beside RECOVERY_KEYS said "not before 2b", which this slice meets, so it would stop guarding while the .pkg path and the site are not done. Rewritten as the hard gate (the .pkg helper and 2c); engine.reachable's trustedKeys excuse updated to match.
- [WARNING] recorded as the hard gate: the .pkg pinned path still chooses the installer with the built-in keys (Swift helper). Not changed here (a compiled helper, with the site work in 2c); the plan's weakest premise names it and the path table.
- [NIT] fixed: the plan claimed a list published mid-run is taken; it is not (one fetch per attempt).
- [NIT] fixed: a list caught mid-publish read as an attack in setup.sh; the verifier now adds "it may be mid-publish; try again in a minute".
- [NIT] fixed: the new test now runs post too (a VERSION file the manifest lists). Remaining, failing safe: the http(s) query branch (od/tr) is never run by a test (every case uses file://), and a tmux form that took the list but used KEYS would pass (tmux checks the same manifest early already checked with the list).
### Iteration 2 (sonnet): converged
No BLOCKER, WARNING or CONVENTION. Off path, every installer/installed-copy combination, the capability grep, the list across steps, the record's place outside the swapped folders, and POSIX sh portability checked.
- [NIT] accepted: the "may be mid-publish" suffix is added to every list that does not verify, including a structurally bad one; the signing tool checks its own output with verifyKeyList, so such a list is not published.
- [NIT] accepted: the manifest downloads carry no fresh query (their names are versioned and never change; a stale cached one paired with a fresh list fails closed). The query branch is still run by no test (already recorded).

### Addendum after convergence (05:10)
- The hard gate beside RECOVERY_KEYS now also names the Windows updater (#6607 made it check its manifest with the built-in KEYS). Comment and plan only; no behaviour change.
