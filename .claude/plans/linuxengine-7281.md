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
