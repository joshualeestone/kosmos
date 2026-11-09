# win-version-8309: the Windows kosmos CLI says its version and build (kosmos#8309)

**Posture:** production

Follow-up to #8299 / #8308: on Mac and Linux `kosmos --version` prints "0.8.00 (build e224150682)". The Windows CLI
(`tools/windows/kosmos-cli.js`) had no version verb; `--version` answered "Unknown" with exit 2, and the parity test
listed `version` as a person-only Mac verb on purpose.

## Change (tools/windows/kosmos-cli.js)
- `versionLine(root)`: the version from the install's `app/package.json` (the file the Mac reads), falling back to
  `manifest.json`'s `version`; the build from `manifest.json`'s `source_sha` (hex only), cut to 10 characters as the Mac
  and Linux bundles print, plus `-dirty` only when `source_dirty === true`. No manifest or no commit: the version alone
  (best effort, as the Mac). Neither file names a version: null. Each value is checked for shape before it is printed.
- `verbVersion`: prints the line (exit 0); extra words: the usage (exit 2); no version: says so (exit 1).
- `main()`: `--version` and `-v` are the same verb (as install/kosmos #6084), answered right after the --help check
  and BEFORE the hook, tokens or any request, so it sends nothing. `io.installRoot` is the test seam; by default the
  install folder is `bin\..` (this file sits in the zip's `bin\`).
- In VERB_HANDLERS (so VERBS and the banner name it), USAGE, and DESCRIBE in the Mac's exact words.

## Tests
- New `tools.windows-kosmos-cli-version-8309.test.js` (7 tests, any host): every spelling, dirty, package vs manifest
  version, every no-build case, nothing-named, usage and help; the hook, outbox and fetch throw if touched.
- `tools.windows-kosmos-cli-verbs-parity.test.js`: `version` is no longer a person-only verb.

## Measured by hand (Windows 11 box, 11-09)
The new CLI copied into a scratch copy of the installed layout (bin\kosmos-cli.js beside the real app/package.json and
manifest.json): through the real Git Bash launcher and kosmos.ps1, `--version`, `-v` and `version` print
`0.8.00 (build e224150682)` (the promoted 0.8.00's source e224150682), exit 0; `version extra` prints the usage, exit 2.
