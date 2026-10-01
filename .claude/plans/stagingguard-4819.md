# stagingguard-4819: a site deploy carries the staged Mac build instead of dropping it

Card: joshualeestone/kosmos#4819 (claimed: barondraxum).

## What happened
2026-09-30 19:52 CDT, `tools/deploy-site.sh --publish` ran from a checkout whose dist/ had no
`kosmos-0.7.14-arm64.tar.gz`. The export carries tarballs only by the `dist/*.tar.gz` glob from the
working tree (gitignored), so the deploy dropped the staging tarball while the tracked
`latest-staging.json` still named it. Staging installs and updates failed until the site was
redeployed from the cut box (Mortals) at 20:44. deploy-site.sh already refused a deploy missing the
staged WINDOWS build; it had no Mac twin.

## The change
- `tools/deploy-site.sh`, new block `carry_staged_mac` (between `>>> staged Mac carry (#4819)`
  markers), run after the prod artifacts are fetched and before the export is built:
  - reads the COMMITTED `dist/latest-staging.json` at the pinned `$H` (what the deploy serves);
  - none committed, or it names the prod tarball (`$ART`): nothing extra;
  - validates the name (`kosmos-<ver>-arm64.tar.gz`, bare file name) and the sha (64 lowercase hex);
  - the local `dist/` copy is carried when its bytes AND its `.sha256` both match the pointer's sha;
  - otherwise the copy live serves is fetched with the existing `fetch_verified` (served .sha256,
    temp-then-rename) and must also match the pointer's sha;
  - neither: refuse, naming the tarball.
- Pre-deploy: the export must hold `$STAGED_ART` and `$STAGED_ART.sha256` (literal checks, like the
  other honest-marker lines).
- Post-deploy: `served_matches` on the pair, like the prod tarball.
- DRY RUN summary names the staged build when one was carried.
- `tools/test-deploy-site-staged-mac-4819.sh` (12 checks), wired into `test:shell`.

## Decided, and why
- **Carry, not only refuse** (the card's ask 1 is a refusal). A refusal alone would have blocked the
  very restore that fixed the incident? No: the restore deployed from Mortals, whose dist HAD the
  bytes. But refusing a checkout that lacks a file live still serves makes every site-copy deploy
  from any machine other than the cut box fail after each staging cut; fetching it is what the
  script already does for the prod tarball, tmux and the alias. A refusal remains when neither copy
  exists (the card's "refuses with a line naming the artifact").
- **The local copy wins when it is the pointer's bytes**, so a redeploy from the cut box restores a
  dropped tarball (live would 404). The local copy must ALSO have a matching .sha256, because the
  installer verifies against the served sidecar.
- **Keyed to the COMMITTED pointer**, not the live one: the committed pointer is what this deploy
  serves; carrying what live names would be wrong after a staging publish committed but not yet
  deployed.
- The card's ask 2 (one place both the release and a site deploy read the artifact list) is NOT done
  here: the release builds its export itself and carries what it just built. Stated on the card as a
  follow-up rather than built.

## Not covered
- Historical rollback tarballs stay out of scope (as before).
- The release path (`release.sh`) is unchanged; it does not use deploy-site.sh.
- Only the arm64 staged build: the pointer names one artifact.

## Weakest premise
That the committed `latest-staging.json` is the only Mac staging pointer users follow. If a staging
pointer were ever served by redirect (as the Windows ones are, R2), this would carry the committed
one's tarball and not see the served one. Today the Mac staging pointer is tracked and served
statically (measured: 200 application/json from installkosmos.com).

## Tests
`bash tools/test-deploy-site-staged-mac-4819.sh`: 12 checks, each red-checked by a sabotage (no call;
no fetch; no pointer-sha check after fetch; no bare-name check; local carry ignoring the sidecar; no
export check), each turned it red, restored green. Sibling deploy-site tests and test-served-verify
pass unchanged.
