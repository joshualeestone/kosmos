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
- **trustedKeys runs on every step** (early, tmux, pre, post): idempotent at a seq already recorded, and a newer list published between steps is taken, never an older one.

## Weakest premise
That every update path is run-setup then setup.sh. The .pkg installer's own checks are not touched here (phase 2c with the site work, or found otherwise by review), and RECOVERY_KEYS stays empty until the whole chain is wired, as the rule beside it says.

## Validation
- install.recoverykey-setup-6609.test.js (6): the real setup.sh functions under /bin/sh against an installed copy with throwaway keys. Mutants measured red: no list handed to the verifier (2), the verifier ignoring the list (4), the installer always fetching (1), a missing list falling back to KEYS (1), the tmux form using KEYS (1).
- All 32 install.*.test.js plus engine/manifest-verify.recovery-6609 and engine.reachable: 356 pass, 0 fail, 0 skipped.

## Review log
