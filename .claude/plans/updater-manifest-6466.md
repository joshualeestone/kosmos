# updater-manifest-6466: the Windows updater checks a signed release manifest, and pins more than the signer name

**Posture:** production

Addresses #6466 (asks 1 to 4), section C of Angel's 2026-10-18 checklist on #6409, and the review notes on #6437 and
#6451. Windows parity with the Mac's #6468 (#6472, #6475).

## Finished looks like

- The INSTALLED Windows copy refuses an in-app update unless a release manifest signed by the release key it pins
  verifies, names the pointer's version, platform, arch, zip and sha256, and lists every file the unpacked zip holds,
  by sha256, before anything from the download runs (node.exe, Kosmos.exe's signature check).
- A missing, unsigned, edited or mismatched manifest is refused (never waved through), as on the Mac.
- The Authenticode check on Kosmos.exe pins the whole validated subject, the Code Signing EKU and a chain that builds,
  in the updater and in setup.ps1 alike. No leaf thumbprint.
- `--from` refuses a Kosmos.exe (or anything it copies) that is not a plain file.
- The release side: the Windows build writes the manifest; it is signed by the Mac's unchanged step and key;
  publish-r2.ps1 checks it against the zip, uploads it before the pointer, confirms it is served, and refuses to stage
  a build whose updater checks manifests without one.
- Tests: tampered node.exe, app file, connector and manifest.json; unsigned, wrongly signed, edited, missing and
  mismatched manifests; links under `--from`; the stronger pin; the release tool; the publish refusals.

## Design

- **Format, key, signing step: the Mac's.** `tools/build-kosmos-bundle.sh`'s manifest shape (`manifest: 1`,
  `version`, `arch`, `artifact`, `sha256`, `pinned_keys`, `files: [{ path, sha256 }]`) plus `platform: "win32"`,
  written by the new `tools/lib/win-release-manifest.js write`. Signed by the unchanged
  `tools/lib/manifest-sign.js sign` with the one ed25519 key `engine/manifest-verify.js` pins
  (`kosmos-manifest-signing`). Published as `kosmos-<v>-win-x64.manifest.json` and `.sig` beside the versioned zip.
- **Verifier: the Mac's, shared.** `engine/manifest-verify.js verify()` is split into `signedManifest()` (signature
  over the exact bytes, version, not older than installed) and `filesRefusal()` (exactly the listed files, by sha256,
  no links), with `listFiles(stage, parts)`. `verify()` keeps its behaviour (the Mac suites give identical results
  before and after on this box; CI runs them on macOS). `win32HeaderRefusal()` adds the Windows fields.
- **Where it runs.** `engine/win32update.js` `prepare()`, which the installed board (or the connect-only updater)
  runs: B1b after the pointer and before any download, B3b after the unpack and before B4. Keys are the installed
  copy's own `manifestVerify.KEYS`; `manifestKeys` is an in-process seam for the suites only.
- **Rollout, refuse vs warn: refuse, Mac-consistent.** An installed copy with this code refuses an update with no
  signed manifest. Older copies cannot check, so they update to the first build carrying this as before. That first
  build cannot be STAGED without its own signed manifest, served through installkosmos.com (publish-r2.ps1 reads the
  build's own updater for the capability line `win32update capabilities: signed-manifest`, and confirms the manifest
  and .sig are served before it moves the pointer). So no install starts enforcing until the pipeline has proved it
  can sign and serve. Promote refuses a build without a manifest over a prod whose current build was published with
  one. Staging pointers get the same rule as prod (the updater does not tell channels apart here).
- **`--from` is not checked against a manifest.** It runs the NEW copy's own engine (KosmosLauncher.cs
  `UpdateInstalledCopy`), so a check there would be the download checking itself, and an offline manual update would
  break. It gains the plain-file check (ask 3); its trust is the fresh install's.
- **Authenticode (ask 2, ask 4).** Subject `CN="Kosmos Agent Manager, Inc.", O="Kosmos Agent Manager, Inc.",
  L=Mckinney, S=Texas, C=US` (the six signed launchers in this repo's history and the installed one all carry it,
  measured 2026-10-19), EKU 1.3.6.1.5.5.7.3.3, `X509Chain.Build` true. Not the identity-validation EKU's value
  (1.3.6.1.4.1.311.97.<n>...): it changes if the validation is redone, and a pin that changes strands installs.

## Release operators (Mac fleet) must

1. Add installkosmos.com `/dist` redirects (vercel.json, project chaoskosmos) for
   `kosmos-:v-win-x64.manifest.json` and `.manifest.json.sig` to dl.chaoskosmos.com (today both 404).
2. Sign each Windows manifest with `kosmos-manifest-signing` (or file a copy of the key on the Windows PC with
   /add-secret and set KOSMOS_MANIFEST_KEY for the build).

## Not covered (stated)

- setup.ps1 fresh installs do not check the manifest (same origin as the script itself).
- The staged tree and a kept rollback build are not re-checked between the check and the swap.
- publish-kosmos-windows.sh and promote-channel.sh --family win (reference only per RELEASING.md) are unchanged.
