# Plan: kosmos#1920 — after install, a machine cannot verify what it runs matches what was published

## The gap (measured from a user machine by Splinter2)
`latest.json` is 21 bytes — version only. No artifact sha, no checksum, no pointer to a
manifest. So after installation a machine has **no way, online or offline, to check that
what it is running matches what was published**: nothing on disk to hash against, and
(without a pointer) no discoverable URL to hash against either.

**The claim is bounded (kept as the card bounds it):** this is NOT "downloads are
unverified" — `install/setup.sh` verifies the tarball against its `.sha256` sidecar at
install time. The supported claim is only about the state AFTER installation.

## What already exists (so the fix is small)
- The whole-artifact **sha256 already exists**: the served `.sha256` sidecar
  (`build-kosmos-bundle.sh`) and the manifest's `sha256` field (`KM_SHA`).
- The **per-file manifest is already produced AND served**: `kosmos-$V-arm64.manifest.json`
  is copied and committed into `_site_paths` (`release.sh`, #776), so it is fetchable
  beside the versioned tarball. Its `files[]` is `[{path, sha256}]` over the exact set the
  tarball packs (`bin app runtime VERSION`).
- What is missing is only: (a) the sha in `latest.json`, (b) a **pointer** so the served
  manifest is discoverable, and (c) an after-install check that uses them.

## Reconciling the card's "manifest 404 at six paths"
The manifest IS committed to `_site_paths` and served at the VERSIONED path. The card's six
probed paths did not resolve — most likely they were unversioned/guessed names, or a
release predating #776 never committed that version's manifest. Either way the fix is
forward-correct: it names the versioned manifest `_site_paths` serves, and the self-check
FAILS LOUDLY (throws) if the manifest is unreachable rather than passing vacuously — so a
genuine deploy gap surfaces instead of hiding.

## The fix
1. **`tools/release.sh`** — `latest.json` now carries `version`, `sha256` (read from the
   `.sha256` sidecar that was just verified in place with `shasum -c`, so it cannot
   advertise a digest the served pair rejects), `artifact` (versioned tarball name), and
   `manifest` (versioned manifest name). Backward-compatible: `version` stays first and
   `engine/update.js` still reads only `version`.
2. **`engine/selfcheck.js`** (new) — the after-install verifier:
   - `verifyFiles(root, files)`: re-hash each on-disk file under the installed root against
     the manifest `files[]`, report every mismatch / missing / bad(path-escaping) entry.
     An empty `files[]` is NOT a pass (the vacuous-pass this card is about).
   - `fetchManifest({base, doFetch})`: fetch `latest.json`, follow its `manifest` pointer,
     fetch the manifest — throwing loudly if either is unreadable.
   - `selfCheck({base, root, doFetch})`: reads the INSTALLED version (`app/package.json`) and
     verifies against the manifest for THAT version (versioned name), not the newest — a
     machine one release behind matches what IT received instead of mismatching every file;
     `behind` reports the merely-behind state distinctly. Returns `{ok:false, reason}` for a
     from-source checkout or an unreadable installed version.
   - A CLI (`require.main`) so a person or cron can run `node engine/selfcheck.js` and get a
     non-zero exit on any mismatch. A verifier nobody can invoke is not a verifier.
3. **Tests**:
   - `engine/selfcheck.test.js` — the load-bearing arm is the **byte-corruption CONTROL**:
     the SAME check returns OK on the manifest's bytes and a NAMED MISMATCH after one byte
     is flipped (asserts ok BEFORE and mismatch AFTER, so the failure is caused by the
     corruption, not by a check that fails on everything). Plus missing-file, vacuous-pass,
     path-escape, and the fetch/pointer/end-to-end arms. Perturbation-verified: removing the
     sha comparison reds exactly the corruption arms.
   - `bundle.manifest.test.js` — source-grep guards (the repo's style for release.sh shape):
     `latest.json` sources the sha from the verified sidecar and carries a manifest pointer
     matching the served versioned name; `engine/selfcheck.js` is runnable, compares on-disk
     shas, and refuses an empty manifest.

## Scope / deferred (per the card)
- **Online** self-verification (fetch the served manifest) is tonight's fix. **Offline**
  self-verification would need the manifest retained ON the installed machine — a larger
  change (the manifest is generated after the tarball, so it ships as a sibling, not inside
  it). The card explicitly defers "a discoverable manifest URL / on-disk retention" as the
  larger change; the sha + pointer + online self-check is the version that ships now.
- Full node suite green (3810→3818 with the new tests); `verifyFiles`-break perturbation
  reds the control; `release.sh` parses and the `latest.json` snippet produces valid JSON.

## Location
Kosmos repo (`joshualeestone/kosmos`, local checkout `agent-workforce`). Base origin/main.
Opened for review — Kosmos beta app; per the roster Angel and Mona Lisa deploy to Kosmos.
