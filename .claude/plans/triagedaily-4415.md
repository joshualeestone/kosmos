# kosmos#4415 slice 2b: a daily feedback digest runner an agent can call

Branch `triagedaily-4415`. Agent: renettilley. Not a PR yet; nothing installed, nothing posted.

## What was already there (measured 2026-09-30 before building)

- Slice 2 merged as #4509 (9cf9931ca): `tools/feedback-digest-daily.sh` pulls with `engine/feedbackpull.js`, windows on
  `generated_at` with `feedback-triage.freshSince`, and POSTS five lines to #admin itself. It is not installed.
- No scheduler runs any triage on this Mac today.

## The call

`tools/feedback-digest.js`: a thin Node wrapper over the same two engine pieces the `kosmos feedback pull` and
`kosmos feedback triage` verbs run (`feedbackpull.pull`, then `feedback-triage.freshSince` + `triage`), shaped for an
agent (Echo) and a launchd job:

- digest on stdout, reasons on stderr; exit 0 = a digest (including the one-line "no new reports"), 2 = the reports
  could not be read (stdout still says so on its first line), 1 = usage or internal error
- `--dry-run` reads the watermark and writes nothing; a real run also writes `digest.txt` and `pending` (mode 600,
  folder 700) under `~/.cache/kosmos-feedback-digest-4415`; `--mark-posted` moves `pending` to `last-seen`
- pulled reports land in a private temp dir (mode 700) that is removed in a `finally`
- crash or data loss lines first, then ranked candidates with the number of distinct INSTALLS that raised each, then
  likely duplicates of open cards (the engine's own `matchOpenCard`), then the /admin inbox link; one Discord message
- least access: only the store's read token (secrets-map target `vercel-blob-feedback`); the admin token is never read

Engine change (additive): `triage()` records carry `reports` and `installs` (distinct counts) beside `count` (items).
A report may carry an optional `install`; without one it counts as its own install.

## Rejected

- **Paging `/api/admin-reports` with the admin token.** Built first, then dropped on Splinter's 14:44 direction: the
  store token is enough to read, and a second reader of the same store with a broader token is not least access.
- **Shelling out to `kosmos feedback triage --since YYYY-MM-DD`.** `--since` is inclusive by DAY
  (`feedback.reportsForTriage`: `date < since` is skipped), so every morning would repeat the previous run's day.
  `freshSince` on `generated_at` is second-granular, so each report lands in exactly one digest. The installed
  `kosmos` CLI may also lag the repo's engine.
- **Extending `feedback-digest-daily.sh`.** It posts by itself; an agent needs the digest as output and decides the
  post. Only one of the two may be installed; the plan is this runner, and the .sh can be retired once it is.
- **Posting from the runner.** Out of scope by instruction; see below.

## Weakest premise

`generated_at` is written by the INSTALL, not the site. A report written before the last posted digest and delivered
after it is only in the /admin inbox. The site's `receivedAt` would close this, but only the admin endpoint exposes it.

## How the digest reaches #admin (not built, not used)

No shared posting helper exists on this Mac. Each fleet job inlines a curl to the Discord bot API with the main bot's
token from `~/.claude/channels/discord/.env`:
- `~/.claude/bin/builder-oob-alarm.sh` and `tools/feedback-digest-daily.sh` send the `Authorization` header from a
  mode-600 temp file (the token never in argv). This is the pattern to copy.
- `~/.claude/bin/email-daily-cleanup-and-digest.sh` passes `-H "Authorization: Bot $TOKEN"` on the curl command line,
  which puts the token in argv. Do not copy it.

Two ways to finish it, Renet's call after review: (a) Echo runs the runner, posts stdout to #admin with its own
Discord tool, then runs `--mark-posted`; (b) the plist runs a wrapper that posts `digest.txt` with the header-file
pattern and marks posted only on a 200. Either way the watermark moves only after the post lands (at least once).

## Measured

- `node --test tools.feedback-digest-4415.test.js`: 9/9. `engine/feedback-triage.test.js`: 23/23 (one new).
- Mutations, each reddened a test: a failed read rendered as quiet; no crash-first section; `--mark-posted` not
  moving the watermark (first version of that test did NOT catch it, since its later run fell outside 24 h anyway;
  fixed by running one hour later); a failed read offering a watermark; the temp dir kept; `installs` miscounted.
- A first version of the not-filed test read the operator's REAL store token through feedbackpull's fallback to
  `~/.local/bin/secrets-map.sh` (it went only to the stubbed fetch). The test now sandboxes HOME as well as PATH.
- `--dry-run` once against the real store, 2026-09-30 about 14:55 CDT: exit 0, 8 lines, 6 new reports in the last
  24 h, 15 candidates, top 5 shown, each raised by 1 install, no crash section, no open-card matches. Output kept for
  Renet only (not in the repo).
- `tools/feedback-digest.plist.template`: `plutil -lint` OK. Not installed.

## Not verified

- A launchd run (not installed, by instruction), and the post path.
- The tests stub `gh`; only the one live dry run exercised the real card read (it succeeded: no "could not be read" line).
- Whether the fleet will keep a checkout of main current for the plist's `__REPO__`.
