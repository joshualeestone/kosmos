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
   On success there is a window of microseconds between the two renames where the pair is new
   artifact + old sidecar; nothing in this script trusts the local sidecar afterwards
   (`verify_sha` re-fetches the served one).
2. A local file that already matches the served sidecar is not downloaded, but only when a
   one-byte ranged GET (`-r 0-0`) proves the host SERVES an artifact there of the same size:
   final status 206, `Content-Range: bytes 0-0/<N>` with N the local size, exactly one byte back,
   equal to the local first byte. A 206 alone proves nothing, so all four are required. A server
   ignoring Range (200 + body) is bounded by `--max-filesize 65536 --max-time 30` and counts as
   "cannot prove". Any failed proof falls through to the full fetch, which refuses on a 404.
   The guarantee is size + first byte + sidecar sha, NOT every served byte; the post-deploy
   `served_matches` re-hashes the served bytes. (Review WARNING on 6137e7241: the first version
   skipped on the sidecar alone, so a host serving the sidecar but 404ing the artifact passed.)
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

- Not retrying a 404: `curl -f` exits 22 for every HTTP error, a 503 included, and a 503 is worth
  retrying. A real 404 costs two extra requests and 4 s before the same refusal.
- `cmp -n 1` for the first byte: BSD cmp on macOS returned 1 for it on EQUAL bytes (measured), so
  the proof would never pass. Arm j caught it; the code compares two one-byte files.

## Weakest premise

The test extracts the helper block by its markers and runs it alone; it does not run the whole
deploy with a stalling curl. The five existing end-to-end deploy-site tests still pass (same
counts as before the change), which covers the callers, and arm g pins that every artifact caller
uses `fetch_verified`. The speed-limit values are reasoned, not measured on a real slow link.
The ranged probe is tested against a stub that models 206/Content-Range; that the real host
(Vercel) answers `-r 0-0` with a 206 and that header is not measured here (no contact with it from
a test). If it does not, the probe fails closed: every run downloads, as before this card.

## Measured

- `tools/test-deploy-site-fetch-4745.sh`: 42 passed, 0 failed. Wired into `test:shell`.
  Arms h-o added after review: artifact 404 with a correct local copy (h), different served size
  (i), CONTROL proven skip with no download (j), 404 with no local file (k), sidecar outcome on
  the skip path (l), a 206 with the wrong Content-Range (m), a server ignoring Range (n), same size
  but a different first byte (o).
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
  - M7 the first version's skip (sidecar only): 9 FAIL, h, i, j, m, n, o among them.
  - M8 trust the 206 status OR the range: i and m red.
  - M9 no first-byte check: o reds.
  - M10 probe never passes: d, l, j red.
  - M11 probe dir not removed: d, h, n red.

## Review round 2

Round 2 (on 2e7ec7a8c) converged: 0 BLOCKER, 0 WARNING. Two NITs taken, one left.

- NIT 1, taken: the probe read the LAST Content-Range across every header block `-L` dumps
  (`tail -n 1`), so "206 then a final 200 with none" read the earlier hop's value (only the
  `%{http_code}` check stopped it). The parse is now `_final_content_range`: awk resets at each
  `HTTP/` status line, so only the final block counts; CR stripped, name matched case-insensitively.
- NIT 3, taken: arm p feeds canned `curl -D` files straight to the parse: (1) CRLF + HTTP/1.1 +
  capitalised Content-Range parses; (2) a 301 carrying its own Content-Range, then a final 206:
  the final one wins; (3) a 206 with a Content-Range, then a final 200 with none: empty.
- NIT 2, left: the probe fetches one byte. The SIZE is the discriminator (measured by the
  reviewer: the host's fallback page answers 206 `bytes 0-0/8498`, nowhere near a 55 MB tarball);
  the first byte only rules out a same-size file of a different type.

Measured: 45 passed, 0 failed. Existing deploy-site tests unchanged.
- M12, the old `tail -n 1` parse: p3 reds; p2 stays GREEN, because under the old parse the last
  value in "301 then 206" IS the final block's. The old parse was wrong only when the final block
  has no Content-Range, so p2 cannot red against it.
- M13, first Content-Range with no reset: p2 and p3 red, so p2 is armed against the other wrong
  direction.
