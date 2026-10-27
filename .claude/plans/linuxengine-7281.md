# kosmos#7281 slice D: the engine's update path for the Linux family (branch linuxengine-7281)

Design (Baron, 2026-10-26 21:5x), written before building so a restarted session can build it without re-deriving.

## Measured on origin/main e42861c8bb
- engine/update.js:109-118: `UPDATE_POINTERS` has win32 and darwin; `pointerFor` sends everything not win32 to the Mac
  pair, so a Linux board polls latest.json / latest-staging.json.
- engine/update.js `readManifest(platform, body, arch)`: Mac returns `{version}`; Windows also requires a 64-hex sha256
  and `versioned === kosmos-<v>-win-<arch>.zip` for THIS machine's arch.
- engine/manifest-verify.js runSetup (about line 300): hard-codes `${b}/kosmos-${version}-arm64.manifest.json` and
  `.sig` ("arm64 only, as setup.sh's ARCH is on a Mac").
- engine/manifest-verify.js verify (about 117-147): only Windows has a header refusal; the Mac never checks `platform`.

## What to build
1. **update.js:** a `linux` row in UPDATE_POINTERS (`latest-linux.json` / `latest-linux-staging.json`), used only on
   Linux x86_64 (process.arch `x64`). TRANSITIONAL, mirroring setup.sh slice B: when the Linux pointer gives no
   readable version (404, HTML, no version), the look falls back to the Mac pair (what every Linux board reads today),
   and says which one it read. readManifest for linux: the Windows-style checks with `versioned ===
   kosmos-<v>-linux-x64.tar.gz` (the pointer's field name to agree with slice C's writer).
2. **manifest-verify.js runSetup:** the manifest name by family: `kosmos-<v>-linux-x64.manifest.json` on a Linux-family
   install (decide from the installed manifest's own `platform`, or the same pointer rule), else today's -arm64.
3. **manifest-verify.js verify (review 1 N2, MUST land no later than slice C):** a Mac refuses a manifest whose
   `platform` is present and not `darwin`; a Linux-family install refuses one whose platform is not `linux`. Otherwise
   one key signs all families, and a host could serve a Linux tarball at a Mac URL that passes every Mac check.
4. Tests: pointer choice per platform/arch/channel (Mac and Windows unchanged as controls); the transitional fallback;
   readManifest's linux arm refusing another arch's name; verify refusing a cross-platform manifest (a darwin control).

## Weakest premise
That slice C's Linux pointer carries `versioned` (as the Windows pointer does). If slice C writes the Mac-shaped
pointer instead, readManifest's linux arm reads `{version}` only, and the arch check moves to the manifest.

## Built (2026-10-26 22:2x), and where it departs from the design above
- update.js: `pointerFamily(platform, arch)` (win32 | linux only for x64 | darwin), `UPDATE_POINTERS.linux`,
  `pointerFor(platform, channel, arch = updateArch())`, `linuxBuildName`; readManifest's linux arm is the Windows checks
  with `versioned === kosmos-<v>-linux-x64.tar.gz`. `setPlatform(p, arch)` gained the arch seam (no new export).
- TRANSITIONAL in refresh(): a Linux x86_64 board whose Linux pointer gives no readable version reads the Mac pair, and
  the cache records `family`. DEPARTURE: a board that already runs the Linux family (installed runtime/bin/node is a
  regular file) never falls back, so an unreadable pointer is no offer rather than a Mac version (mirrors setup.sh B).
  A thrown second read is no offer, not "could not reach" (the first answer proved the host was reached).
- manifest-verify: `platformRefusal`. DEPARTURE from item 3: Linux does NOT require platform "linux"; it refuses only a
  manifest that NAMES another platform. Reasons: the shell shards run on Linux runners and verify Mac-shaped (unnamed)
  manifests, and a Mac bundle on Linux fails setup.sh's run probe of its own node before any swap. The Mac refuses any
  named platform but darwin, which was the dangerous direction. The installer-only check (skipTarball) is exempt: both
  families of a cut carry the same setup.sh. Weakest premise: release.sh cuts both families at one version, so the
  arm64 manifest exists for any version a portable Linux copy is offered (slice C must keep that true).
- `setupManifestName(version, home, {platform, arch})`: linux-x64 manifest only on a Linux x86_64 copy with its own node.

## Review 1 (2026-10-26 22:2x): 0 blockers, 4 warnings, 2 nits
- W1 FIXED (measured by the reviewer under a linux/x64 preload): update.win32-check.test.js asserted pointerFor('linux',
  'prod') === 'latest.json', which is false on a Linux x64 runner (linux.yml). Now arch-explicit (arm64 -> latest.json,
  x64 -> latest-linux.json); 19/19 under the same preload.
- W2 FIXED: the fallback fired whenever the strict Linux read failed, including a pointer that names a version with a
  bad `versioned`; setup.sh takes the family on any a.b.c version, so the board would offer the Mac version while
  setup.sh installed the Linux one. Now the fallback needs the Linux pointer to name NO a.b.c version (setup.sh's test);
  otherwise no offer. Tested both ways; mutant red.
- W3 DECIDED: offers from the Linux pointer (a board below glibc 2.35 still reads it, setup.sh then installs the
  portable bundle at the Mac version) are safe only while both pointers of a channel name the same version. That is
  slice C's lockstep invariant (plan .claude/plans/linuxrelease-7281.md on branch linuxrelease-7281): the cut writes
  both at V, a promote moves both, a one-family move is refused.
- W4 FIXED: a copy that runs its own Linux node now takes only a manifest that says "linux" (unnamed refused), so a
  host cannot hand it the Mac build under the Linux name; unnamed stays acceptable on a portable copy. One helper,
  `ownsLinuxNode(home)`, for verify's CLI form and setupManifestName. Tested via verify({ownLinux}); mutant red.
  GAP, stated: the CLI's `ownLinux: ownsLinuxNode(home)` wiring has no test that can fail on it (the CLI checks only
  the pinned release keys, so a test-signed manifest is refused on its signature before the platform check). The
  call site is one line beside the key and version arguments.
- NIT FIXED: cache.family was written and never read; dropped. NIT LEFT: pointerUrl() in the boot log names the
  Linux pointer even when the fallback answered (log text only).

## Review 2 (2026-10-26 22:2x): 0 blockers, 1 warning, 2 nits
- WARNING FIXED: `linuxNamesVersion` trimmed the version, so " 1.2.3" named a version for the board and none for
  setup.sh's sed (board: no offer; setup.sh: portable at the Mac version). It now tests the raw string, as the sed
  does; a padded-version case is in the review-1 test; re-adding the trim is red.
- NIT FIXED: one own-node rule. update.js's linuxFamilyInstalled now calls manifest-verify's exported ownsLinuxNode.
- NIT RECORDED (weakest premise): a Linux pointer setup.sh's sed can read but JSON.parse cannot (a nested or duplicate
  "version" key, invalid JSON) sends the board to the Mac pointer while setup.sh takes the Linux family: offer X,
  install Y. Needs a malformed pointer; write-latest-pointer.js writes valid JSON, and slice C's lockstep makes X = Y
  anyway when both pointers move together.
- Reviewer measured: all suites pass plainly and under a linux/x64 preload (56/56 after this round); the portable ->
  family transition verifies (a portable copy's node is a symlink, so ownLinux is false and "linux" passes).
