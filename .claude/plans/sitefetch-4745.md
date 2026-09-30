# sitefetch-4745: deploy-site.sh must never fetch onto an artifact's real name

Card: joshualeestone/kosmos#4745 (filed by Baron Draxum). Built by Renet Tilley.

## The call

`tools/deploy-site.sh` fetched each live artifact with `curl ... "$1" -o "$2"` straight onto the
real path. A stalled download (curl exit 18) refused correctly but left a half file under the real
name (52,555,779 bytes became 26,229,410 on 2026-09-30), and the fetch had no time limit.

Now, in one marked helper block (`# >>> site-fetch helpers (#4745)` to `# <<<`):

1. `fetch_verified <url> <dest>` fetches the `.sha256` sidecar to a temp, then (unless the local
   file already has that sha) the artifact to a temp beside the target
   (`<dir>/.fetch-<pid>-<name>`, same directory so `mv` is an atomic rename), checks the temp's
   sha against the sidecar, and only then renames the artifact and then the sidecar into place. A
   failed, partial or mismatched fetch removes both temps and leaves the old PAIR byte-identical.
2. A local file that already matches the sidecar is not fetched.
3. Per attempt: `--connect-timeout 15`, `--speed-limit 1024 --speed-time 60` (a stall under
   1 KB/s for 60 s aborts the attempt), `--max-time 1200` (20 min; the largest artifact is about
   55 MB, so only a link below about 46 KB/s, 0.37 Mbit/s, is cut). 3 attempts, 2 s apart.
4. The unverified `Kosmos.pkg.inputs` goes through the plain `fetch`, which is atomic too.
5. The original refusal text is kept verbatim. `verify_sha` still runs after each pair, unchanged.
6. Temps are dotfiles, so the export's `dist/*.tar.gz` glob can never carry an orphan. They are
   removed on every refusal explicitly and by EXIT/INT/TERM/HUP traps (no other trap exists in the
   script or its sourced libs; measured).

Callers changed: the versioned `$ART` pair, the pkg triple, tmux, and the site-copy alias. The
promote alias (derived by `cp` from `$ART`) and every post-deploy served check are untouched.

## Rejected

- `curl --retry 2`: curl's retry does not cover exit 18, the card's exact failure. `--retry-all-errors`
  would, but an older curl on another box would reject the flag and refuse every deploy.
- Verifying against `latest.json`'s sha for `$ART`: in site-copy mode that would add a new refusal
  path; the sidecar is what `verify_sha` already checks, and the promote CSHA pin stays after it.
- Moving the helpers to `tools/lib/`: the script sources libs from `$REPO` (agent-workforce), so a new
  lib would make an older `$REPO` refuse at the precondition. The test extracts the block instead.
- Writing the new sidecar first to the real name: a refusal would then leave a new sidecar beside
  an old artifact.

## Weakest premise

The test extracts the helper block by its markers and runs it alone; it does not run the whole
deploy with a stalling curl. The five existing end-to-end deploy-site tests still pass (same
counts as before the change), which covers the callers, and arm g pins that every artifact caller
uses `fetch_verified`. The speed-limit values are reasoned, not measured on a real slow link.

## Measured

- `tools/test-deploy-site-fetch-4745.sh`: 25 passed, 0 failed. Wired into `test:shell`.
- Existing: promote 18/18, winderive 18/18, served-win-3600 47/47, exit0-2791 7/7,
  branch-guard-3073 9/9, identical to the pre-change baseline. shell-shard-4317 12/12, zsh-tied-names 0 failures.
- Mutations (each restored and confirmed with cmp):
  - M1 revert to fetch-in-place: 9 FAIL, including "a: the original artifact was changed (100000
    bytes, was 150000)", the card's shape.
  - M2 no skip-when-correct: d reds (artifact fetched 3 times).
  - M3 one attempt: a and e red.
  - M4 no sha check before mv: b reds (original replaced by unverified bytes).
  - M5 no time limit: f reds.
  - M6 no temp cleanup on refusal: "a temp file was left behind" reds.
