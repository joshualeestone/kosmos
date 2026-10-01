# stagingguard-4819: a site deploy carries the staged Mac build instead of dropping it

Card: joshualeestone/kosmos#4819 (claimed: barondraxum).

("Review N" below means challenge-loop iteration N of this branch's pre-PR review.)

## Behaviour at a glance (staging pointer committed at the deploy's commit vs. what live serves)

| Situation | Result |
|---|---|
| No staging pointer committed, live serves none | nothing to carry |
| Staged build is the prod build | nothing extra to carry |
| Local dist/ has the pointer's bytes | carried (sidecar written from them if missing or wrong) |
| No good local copy, live serves the pointer's build | fetched from live and carried |
| No copy anywhere, staged build newer than prod | refused, naming the tarball |
| No copy anywhere, superseded, live pointer unchanged | warned, nothing carried (a stray local tarball or .sha256 of other bytes refuses instead) |
| No copy anywhere, superseded, deploy would move the pointer | refused |
| Live serves a NEWER staging version than committed | refused before any fetch (opt-in: `KOSMOS_STAGING_ROLLBACK=<committed version>`) |
| Same version, different bytes / live pointer names no build | refused (same opt-in) |
| Live serves a pointer, none committed | refused |
| Live unreachable, 5xx or 429 (after 3 tries) | refused as "could not read" |
| An empty 200 for the live pointer or the staged .sha256 | refused (neither a value nor absent) |
| After the deploy | the pair is served-verified and the served pointer must equal the committed one |

## What happened
2026-09-30 19:52 CDT, `tools/deploy-site.sh --publish` ran from a checkout whose dist/ had no
`kosmos-0.7.14-arm64.tar.gz`. The export carries tarballs only by the `dist/*.tar.gz` glob from the
working tree (gitignored), so the deploy dropped the staging tarball while the tracked
`latest-staging.json` still named it. Staging installs and updates failed until the site was
redeployed from the cut box (Mortals) at 20:44. deploy-site.sh already refused a deploy missing the
staged WINDOWS build; it had no Mac twin.

## The change
- `tools/deploy-site.sh`, a new block between `>>> staged Mac carry (#4819)` markers, defining two
  functions:
  - `check_staging_not_stale`, run after the promote/site-copy `latest.json` handling (in every mode, dry run included) and BEFORE any
    artifact is fetched (review 5: a refused checkout must not download anything or touch the
    shared dist/ first), reads the LIVE `latest-staging.json` and refuses a stale checkout: one that commits none
    while live serves one, or commits an older staging version than live (deploying either would
    move staging back and drop the newer tarball, the incident one version over; review 3). A
    committed staging NEWER than live (a publish not yet deployed) proceeds. A deliberate staging
    ROLLBACK (publish-staging-pointer.sh to an older version, then this deploy, the recorded way to
    put staging back) passes only with `KOSMOS_STAGING_ROLLBACK=<the committed version>` (review 4;
    publish-staging-pointer.sh now says so). A live pointer whose name does not parse refuses,
    and the same opt-in replaces it (review 6: otherwise a corrupt live pointer blocks every site
    deploy). The same version with different bytes (a same-version re-cut) refuses too, since which
    build is newer cannot be told, and the opt-in deploys the committed one (review 7). A committed
    pointer that names no build refuses with "repair it". Unpublishing staging on purpose has no
    path through this script, and the refusal says so;
  - `carry_staged_mac`, run after the prod artifacts are fetched and before the export is built:
  - every live read records the HTTP status and is tried up to three times on a transport failure,
    a 429 or a 5xx (reviews 11, 14); only a 404 counts as absent, anything else that is not a 200 refuses as
    "could not read" (review 3: a network blip must not read as "not served", and
    must never take the superseded skip);
  - reads the COMMITTED `dist/latest-staging.json` at the pinned `$H` (what the deploy serves);
  - none committed, or it names the prod tarball (`$ART`): nothing extra;
  - validates the name (`kosmos-<ver>-arm64.tar.gz`, bare file name) and the sha (64 lowercase hex);
  - the local `dist/` copy is carried when its bytes match the pointer's sha; a missing or wrong local
    `.sha256` is rewritten from those verified bytes (review 8: on the cut box right after a cut, live may
    not serve the pair yet, so asking live would refuse a good deploy);
  - otherwise the served `.sha256` is read FIRST and must name the pointer's sha (so a refusal never
    leaves wrong bytes in the shared `dist/` under the real name), then the copy live serves is
    fetched with the existing `fetch_verified` (served .sha256, temp-then-rename);
  - neither copy: refuse, naming the tarball, UNLESS the staged version is not newer than prod
    (`sort -V` on the versions in the two names), when it is superseded: warn and carry nothing.
- Pre-deploy: the export must hold `$STAGED_ART` and `$STAGED_ART.sha256` (literal checks, like the
  other honest-marker lines).
- Post-deploy: `served_matches` on the pair, like the prod tarball, and the served
  `latest-staging.json` must equal the committed one (as the Windows staging pointer already is),
  read again twice on a mismatch before it fails, since an edge can serve the old pointer briefly
  (review 14; a persistent mismatch is arm 16, the brief one has no arm).
- DRY RUN summary names the staged build when one was carried.
- `tools/test-deploy-site-staged-mac-4819.sh` (36 checks), wired into `test:shell`; end-to-end
  arms in `tools/test-deploy-site-promote.sh` that run the real script.

## Decided, and why
- **Carry, not only refuse** (the card's ask 1 is a refusal). Refusing a checkout that lacks a file live still serves makes every site-copy deploy
  from any machine other than the cut box fail after each staging cut; fetching it is what the
  script already does for the prod tarball, tmux and the alias. A refusal remains when neither copy
  exists (the card's "refuses with a line naming the artifact").
- **The local copy wins when it is the pointer's bytes**, so a redeploy from the cut box restores a
  dropped tarball (live would 404). Its `.sha256` is written from those bytes when missing or wrong
  (review 8), and the installer verifies against that served sidecar.
- **A superseded staged build is skipped with a warning, not refused** (review 2), but ONLY when
  this deploy leaves the live staging pointer as it is (review 13): when it would MOVE the pointer
  to a superseded build nobody serves (a rollback to a dropped build, say), it refuses instead. The warning says
  staging-channel installs already fail on that pointer and how to fix them (review 11): skipping
  changes nothing for them, since nobody serves the tarball before or after. As #3600 does
  for Windows: a pointer naming a build older than prod (or equal) names something nobody will
  promote, and refusing would block every deploy from a checkout without that old tarball. Still
  carried when a copy exists; served bytes that do not match the pointer still refuse.
- **The local carry trusts the local bytes** without asking live (review 2): that is the cut-box
  restore, where live 404s. The bytes must hash to the pointer's sha; the sidecar this deploy then
  serves is written from them, and the installer verifies against it.
- **A superseded build served nowhere, with a local copy of OTHER bytes, refuses** (review 8): the
  export's glob would otherwise ship it unchecked under the name the pointer names.
- **Keyed to the COMMITTED pointer**, not the live one: the committed pointer is what this deploy
  serves; carrying what live names would be wrong after a staging publish committed but not yet
  deployed.
- The card's ask 2 (one place both the release and a site deploy read the artifact list) is NOT done
  here: the release builds its export itself and carries what it just built. Stated on the card as a
  follow-up rather than built.

## Not covered
- Historical rollback tarballs stay out of scope (as before).
- The release path (`release.sh`) is unchanged; it does not use deploy-site.sh. Its export carries
  tarballs by the same glob, so a cut on a box without a staged tarball that is still newer than
  prod (a prod hotfix cut while staging is ahead) can drop it the same way (review 9). Closing that
  is the card's ask 2 (one artifact list both paths read), recorded on the card as the follow-up.
- Only the arm64 staged build: the pointer names one artifact.
- A site checkout that has not pulled after a deliberate staging ROLLBACK still commits the newer
  staging pointer, and its next deploy puts it back: by version it looks exactly like a publish not
  yet deployed (review 17). Closing it needs a freshness check against the site checkout's remote;
  the usage header tells the operator to sync the site checkout after a staging rollback.
- A staging cut that publishes a newer pointer between this deploy's pre-check and its post-deploy
  check makes the post-deploy comparison fail ("investigate") after a good deploy (review 18). The
  window is a few minutes and the failure is loud, not silent.

- A local copy whose bytes match the committed pointer is deployed even if live serves other bytes
  under the same name while its pointer is unchanged (review 12). It can only put back the bytes the
  committed pointer names, so it is accepted rather than guarded.

## Weakest premise
That the committed `latest-staging.json` is the only Mac staging pointer users follow. If a staging
pointer were ever served by redirect (as the Windows ones are, R2), this would carry the committed
one's tarball and not see the served one. Today the Mac staging pointer is tracked and served
statically (measured: 200 application/json from installkosmos.com).

## Tests
- `bash tools/test-deploy-site-staged-mac-4819.sh`, 36 checks on the extracted block: nothing
  committed; staged == prod; local copy carried (control); the incident (no local copy, live serves
  it); no copy anywhere refuses; wrong local bytes; local without its sidecar (carried, sidecar written); a wrong
  local sidecar rewritten; live serving other bytes refuses before fetching; a refusal leaves the
  local file byte-identical; superseded, served nowhere, with a stray local copy refuses; superseded with no
  copy warns when the pointer is unchanged and refuses when the deploy moves it, superseded but served is carried, 9.9.10 over 9.9.9 is newer; live staging newer than
  the checkout's refuses, the rollback opt-in passes only for the committed version, older proceeds (control), live-only pointer refuses, an unparsable live pointer refuses and the opt-in replaces it, same version with different bytes refuses and the opt-in deploys it, a malformed committed pointer refuses with "repair it", live unreachable
  refuses as "could not read", one transport blip and one 503 are retried, an empty 200 for the live pointer or the staged .sha256 refuses, a superseded build whose sidecar read fails refuses; a path name and a
  missing sha refuse before any fetch; the wiring (call before the export, export checks, post-deploy
  served-verify).
- `bash tools/test-deploy-site-promote.sh` arms 12-20, the real script end to end: carried from live
  and deployed; a deploy that drops it fails the served-verify; no copy anywhere refuses before the
  deploy with live untouched; a checkout behind live's staging refuses with live untouched, and the
  same checkout deploys with KOSMOS_STAGING_ROLLBACK (and nothing was downloaded before the refusal);
  arm 16: a deploy serving a different staging pointer than committed fails the post-deploy check;
  arms 17-18 on the incident's own path, a site-copy `--publish`: carried from live and deployed, and a
  checkout behind live's staging refused before any fetch.
- Red-checked by sabotage, each turning its arm red then restored: no call; no fetch; no bare-name
  check; local carry ignoring the sidecar; no export check; no post-deploy served_matches; the
  pre-fetch sidecar check disabled; the superseded branch disabled; `sort -V` replaced by `sort`.
  Review 3 added: stale-pointer refusal disabled; a failed pointer read treated as absent; a failed
  sidecar read treated as absent. Each turned its arm (st1, st4, st5) red. Review 4: the stale
  guard disabled (st1, st1r and both e2e arm-15 checks red); the rollback opt-in disabled (st1r and
  the e2e rollback check red). Review 5: the stale check called after the prod fetch (k and e2e
  arm 15 red); the post-deploy pointer comparison made tautological (e2e arm 16 red). Review 6: the
  unparsable-pointer opt-in disabled (st6r red). Review 7: the same-version guard disabled (st7 red). Review 8: no carry call
  (k and e2e 12-14, 17 red); the sidecar not written (g, g3 red); the stray-copy refusal disabled (s4 red). Review 11: one attempt instead of
  three (st9 red). Review 12: the post-deploy pointer re-read now uses the same three-try reader.
  Review 13: the moves-the-pointer refusal disabled (s5 red). The post-deploy "none committed, so
  live must 404" check has no test arm: reaching it needs a race the pre-deploy check closes.
  Review 15 (nits only, fixed anyway): the post-deploy loop no longer shares its loop variable with
  the reader's own loop (the "last try" check read the inner value; no arm, it changes only a sleep);
  the empty-200 refusal disabled (st11 red); 5xx no longer retried (st10 red). Review 16: the
  rewritten sidecar is mode 644 like the fetched ones (mktemp made it 0600); without the chmod, g red.
  Review 17: the post-deploy re-read retries a 404 like a mismatch (a stale edge answers 404 when
  there was no pointer before; e2e arm 19 holds the pointer back once, and without the 404 retry it
  is red). Review 18: an empty 200 for the staged .sha256 refuses (st12; without it, the superseded
  skip is taken, red). Review 20: a superseded build whose tarball is live but whose .sha256 is not
  is skipped, which drops the tarball: accepted, since staging installs already fail on a pair with no
  served checksum (setup.sh verify_download refuses a download whose .sha256 is not served), so
  the skip changes nothing for them. Review 21: the committed pointer's name and sha are validated
  in check_staging_not_stale, before any fetch, in every case (it was only before the fetch when live
  differed): e2e arm 20 and st13; without the early call, arm 20 red. An orphan local .sha256 in the
  superseded skip refuses like a stray tarball (s6; red without it).
  Review 23: arm s3 had gone vacuous after review 13 (a string sort refused through the moves-the-
  pointer branch, so s3 still passed); it now serves an unchanged pointer and asserts the missing-copy
  refusal, so a string sort takes the warn-and-skip and s3 is red. st14 adds the same check for the
  live-vs-committed comparison (live 9.9.10 over committed 9.9.9), with the reverse as control.
  (A post-fetch pointer-sha check remains as a backstop. `fetch_verified` re-reads the served
  sidecar itself, so it fires only if the sidecar changed between the two reads, a concurrent
  publish; no test reaches it.)
- Sibling deploy-site tests and test-served-verify pass unchanged.
