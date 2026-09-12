# win32-staging-channel: a Windows staging channel (release tooling only)

Slice S0 of the Windows in-app updater (design: the 2026-09-12 Plan-agent design,
section 6a and section 7 S0). Code and tests only; nothing is published or deployed.

## Why

The fleetwide rule (Josh, 2026-09-12): every release cut goes to STAGING first, is
verified, and only goes to PROD after Josh's approval. Windows cannot follow it today:

- `tools/publish-kosmos-windows.sh` writes `latest-win.json` (prod) and the alias
  `kosmos-win-x64.zip` directly;
- `tools/promote-channel.sh` and `tools/publish-staging-pointer.sh` are Mac-only (the
  promote's alias logic assumes `.tar.gz`);
- `tools/dist-retention.sh` protects only the prod pointers, so a staged build could be
  pruned before it is promoted.

## What changes

1. **`publish-kosmos-windows.sh` gets `KOSMOS_CUT_CHANNEL`**, in the `release.sh` shape
   (the same variable, the same two values, the same refusal), but **defaulting to
   `staging`**.
   - staging: copies only the versioned zip and its `.sha256`, then writes
     `latest-win-staging.json`. The alias, its sidecar and `latest-win.json` are not
     touched.
   - prod: today's behaviour, byte for byte (`KOSMOS_CUT_CHANNEL=prod`).
   - The channel is validated before anything is staged.
   - Not shared with `release.sh` through a lib: `release.sh` parses the channel inline
     and pins its literal (`bundle.manifest.test.js`, `test-staging-wire-2036.sh`), the
     defaults differ on purpose (the Mac default is still prod, by Splinter's
     invariant), and the pointer names differ per family. So there are two copies of the
     vocabulary, and a test pins them equal (convention 5).
2. **One Windows pointer writer**, `tools/lib/write-latest-win-pointer.js`, used by both
   channels. It keeps today's key order and trailing newline, and refuses an empty field
   (the `write-latest-pointer.js` shape). Both pointers therefore have the same shape. A
   staging pointer's `artifact` is the alias the promote will move, so the promote can
   copy it to prod byte for byte. Until the promote, a consumer fetches `versioned`,
   never `artifact` (design B1).
3. **`promote-channel.sh --family win`** (default `mac`, which is unchanged byte for byte):
   - staging `latest-win-staging.json`, prod `latest-win.json`, artifact field
     `versioned`, with the same bare-filename, sidecar-verify and same-sha checks;
   - no manifest check (Mac only);
   - the alias `kosmos-win-<arch>.zip` is derived from `kosmos-<V>-win-<arch>.zip` and
     checked BEFORE any write. The pointer's `artifact` must be that alias, or the
     promoted prod pointer would name a download the promote does not refresh;
   - the Mac experience and agent-spawn gates do not run (they probe a Mac board).
     Instead two gates run, both required:
     a. **Josh's go for this exact build**: `--approved-version <V> --approved-sha
        <sha256>`, which must equal the staging pointer (and so the verification record).
        Missing or mismatched means a refusal before any write. The approval is logged
        (the version, the sha and a UTC time, never who typed it) to stdout and to
        `$HOME/.claude/logs/win-promote-approvals.log` (overridable with
        `KOSMOS_WIN_PROMOTE_LOG`). **This records a human decision; it is not a check. An
        agent must never pass it without Josh's recorded go.** The Mac promote has no
        approval mechanism today (only the one-time social-post marker, a different
        shape), so this is Windows-only. The Mac may want the same.
     b. **The verification record** (`tools/win-staging-verified.sh`, below).
   - `--force` is refused for `--family win`: neither gate can be forced.
   - No `[port]` for win; the release-notes preview stays Mac-only.
4. **`tools/win-staging-verified.sh <staging-pointer>`**, with the Mac gates' 0/1/2 exit
   contract:
   - 0: a record on this box names the pointer's sha and version, and says `pass`;
   - 1: the record says `fail`, or it is ambiguous (unparseable, a sha or version that
     disagrees, an unknown result, no checks);
   - 2 (HOLD): no record for this sha, or the pointer cannot be read.

   The Mac gates find their state through `store.ROOT` (overridable with
   `KOSMOS_STORE_ROOT`) and keep no record, so the record lives beside the Windows
   anchor: `%LOCALAPPDATA%\Kosmos\release-verify\win-staging-<sha256>.json` (elsewhere
   `$HOME/.local/state/kosmos/release-verify/`), overridable with
   `KOSMOS_WIN_VERIFY_DIR`. Shape: `{version, sha256, source_sha, checks, at, result}`.
   `checks` is a non-empty array, and `result` is `pass` or `fail`. The writer is the
   box's verify script (design 6c, a later slice).
5. **`deploy-site.sh`**: when the committed checkout carries `latest-win-staging.json`,
   derive its versioned zip with the SAME pointer-vs-committed-bytes check as prod (one
   function, used for both pointers). Then honest-marker-check the zip, its sidecar and
   the staging pointer in the export, and served-verify all three after the deploy.
   Absent means skipped (an older checkout).
6. **`dist-retention.sh`**: each family also protects the version (and the versioned
   filename) named by its staging pointer: `latest-staging.json` for arm64,
   `latest-win-staging.json` for win-x64. Output is unchanged when there is no staging
   pointer.

## Callers affected by the staging default

Nothing in the repo invokes `publish-kosmos-windows.sh` (grep: only its test and
comments). Its callers are people: Baron on the mortals box publishes a
verified Windows candidate by hand (the handoff's step 4, "On Josh's go,
`publish-kosmos-windows.sh` runs"). **After this change a bare run stages to
staging.** The download button, `latest-win.json` and the alias do not move until a
`promote-channel.sh --family win` with Josh's go and this box's pass record, followed
by a deploy. `KOSMOS_CUT_CHANNEL=prod` is today's direct-to-prod path, kept as an
escape hatch. Baron has the staging-first policy (Splinter ACKed S0). The caller list
goes in the PR.

Also note: `KOSMOS_CUT_CHANNEL` is shared with `release.sh`, so an operator who exports
`KOSMOS_CUT_CHANNEL=prod` for a Mac cut also gets a prod Windows publish in the same shell.

## Tests

- `tools.publish-windows-2008.test.js`: the staging default writes only the versioned
  pair plus `latest-win-staging.json`; prod writes today's five files and exact pointer
  bytes; after a staging publish the alias, its sidecar and `latest-win.json` are
  byte-identical; the staging and prod pointers for one build are the same bytes; a bad
  channel stages nothing; the vocabulary matches `release.sh`. Existing arms pin prod.
- `tools/test-promote-channel-win.sh` (new): the gate's 0/1/2 arms, and the promote with
  no approval, a wrong sha, a wrong version, no record, a fail record, an ambiguous
  record, `--force`, a non-alias `artifact`, and success (the pointer copied byte for
  byte, the alias derived and verified, the approval logged without a user name). The
  Mac family is pinned by the unchanged `test-staging-channel-2036.sh`.
- `test-dist-retention.sh`: a staged version outside the keep window survives on both
  families.
- `test-deploy-site-winderive.sh`: staged derive, drift and uncommitted-zip arms.
  `test-deploy-site-promote.sh`: the staged pair plus pointer carried and
  served-verified, with a missing-sidecar control.
- Each new assertion is shown red with its change reverted.

## Not tested here

The Windows box runs these through Git Bash with `zip`/`shasum` shims; the Mac (bash
3.2, BSD tools) path is covered by CI's `yarn test:shell`. No live deploy or publish.
