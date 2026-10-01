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
  - otherwise the served `.sha256` is read FIRST and must name the pointer's sha (so a refusal never
    leaves wrong bytes in the shared `dist/` under the real name), then the copy live serves is
    fetched with the existing `fetch_verified` (served .sha256, temp-then-rename);
  - neither copy: refuse, naming the tarball, UNLESS the staged version is not newer than prod
    (`sort -V` on the versions in the two names), when it is superseded: warn and carry nothing.
- Pre-deploy: the export must hold `$STAGED_ART` and `$STAGED_ART.sha256` (literal checks, like the
  other honest-marker lines).
- Post-deploy: `served_matches` on the pair, like the prod tarball.
- DRY RUN summary names the staged build when one was carried.
- `tools/test-deploy-site-staged-mac-4819.sh` (16 checks), wired into `test:shell`; three end-to-end
  arms in `tools/test-deploy-site-promote.sh` that run the real script.

## Decided, and why
- **Carry, not only refuse** (the card's ask 1 is a refusal). Refusing a checkout that lacks a file live still serves makes every site-copy deploy
  from any machine other than the cut box fail after each staging cut; fetching it is what the
  script already does for the prod tarball, tmux and the alias. A refusal remains when neither copy
  exists (the card's "refuses with a line naming the artifact").
- **The local copy wins when it is the pointer's bytes**, so a redeploy from the cut box restores a
  dropped tarball (live would 404). The local copy must ALSO have a matching .sha256, because the
  installer verifies against the served sidecar.
- **A superseded staged build is skipped with a warning, not refused** (review 2), as #3600 does
  for Windows: a pointer naming a build older than prod (or equal) names something nobody will
  promote, and refusing would block every deploy from a checkout without that old tarball. Still
  carried when a copy exists; served bytes that do not match the pointer still refuse.
- **The local carry trusts the local `.sha256`** without asking live (review 2): that is the
  cut-box restore, where live 404s. The pointer sha, the local sidecar and the local bytes must all
  agree; the installer then verifies against the sidecar this deploy serves, which is that file.
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
- `bash tools/test-deploy-site-staged-mac-4819.sh`, 16 checks on the extracted block: nothing
  committed; staged == prod; local copy carried (control); the incident (no local copy, live serves
  it); no copy anywhere refuses; wrong local bytes; local without its sidecar; live serving other
  bytes refuses before fetching; a refusal leaves the local copy byte-identical; superseded with no
  copy warns, superseded but served is carried, 9.9.10 over 9.9.9 is newer; a path name and a
  missing sha refuse before any fetch; the wiring (call before the export, export checks, post-deploy
  served-verify).
- `bash tools/test-deploy-site-promote.sh` arms 12-14, the real script end to end: carried from live
  and deployed; a deploy that drops it fails the served-verify; no copy anywhere refuses before the
  deploy with live untouched.
- Red-checked by sabotage, each turning its arm red then restored: no call; no fetch; no bare-name
  check; local carry ignoring the sidecar; no export check; no post-deploy served_matches; the
  pre-fetch sidecar check disabled; the superseded branch disabled; `sort -V` replaced by `sort`.
  (A post-fetch pointer-sha check remains as a backstop; it is unreachable while `fetch_verified`
  checks the bytes against the sidecar read before it, so no test reaches it.)
- Sibling deploy-site tests and test-served-verify pass unchanged.
