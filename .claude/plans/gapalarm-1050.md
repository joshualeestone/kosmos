# gapalarm-1050: the gap alarm (kosmos#1050)

## Why
Merged work has outrun what reaches anyone five times on record (50, 167, 9, 44, 89 commits; about 330 to prod on 2026-09-28), and each time a person noticed by hand. PigeonPete decided the card on 2026-09-28 (needs-decision sweep for Splinter): a scheduled, read-only check that tells the release owner when main is more than 50 commits or 24 h past staging, or staging more than 48 h past prod. Cuts stay manual.

## Call
- `tools/gap-alarm.js`: reads the served pointers (latest-staging.json, latest.json) and each manifest's `app.commit` (the build's own sha, as tools/shipped-gap.sh does), fetches origin main, and counts with git. "Hours past" is measured from the OLDEST commit still waiting (committer time, which under squash merges is when it merged), so it says how long work has sat.
- Posts, best effort, to the release owner's pane by claude-msg (GAP_ALARM_TO, default barondraxum-discord:0.0) and as a comment on kosmos#1050, so the figures keep their history on the card. It posts when an alarm starts or its reasons change, every 24 h while it lasts, once when it clears, and once a day while it cannot tell. The post clock advances only on a post that went.
- Exit 0 no alarm, 1 alarm, 2 could not tell (not a pass). `--check` prints the verdict and posts nothing.
- `--plist` / `--install`: an hourly LaunchAgent (com.kosmos.gap-alarm) with an explicit node path and a PATH for launchd, generated in JS with escaped values (no shell heredoc, so the #666 heredoc hazard class cannot apply). Installed once on the release owner's box after merge: `node tools/gap-alarm.js --install` from the main checkout.
- Rejected: registering it in engine/fleet-monitors.js. That registry is a per-box expectation audited on every box, and this runs on one box (the release owner's), so every other box would report it missing forever.
- Rejected (Pete's call): freezing main during cuts; a fully automatic cut and promote.
- Weakest premise: that an alarm gets acted on. If the gap stays high while it fires, the next step is automating the staging cut (Pete's stated change-of-mind).

## Evidence
- `node --test tools.gap-alarm.test.js`: 8 of 8. Pure verdict (each limit both sides; nothing waiting is never an alarm) and post rule; end to end against a throwaway repo with dated commits (both channels once, a day later again, the all-clear once); a failed post does not advance the clock; could-not-tell exits 2 and says why; the pointers read from a local HTTP server, with a manifest lacking app.commit as could-not-tell FOR THAT REASON; under the test runner the real claude-msg and gh (stubs placed where the defaults resolve, and no real gh on PATH) are never called, with a control outside the runner that is; the plist lints and installs into a sandbox without loading.
- Mutants, each failing the suite: `>=` for the commit limit; no daily repost; the clock advancing on a failed post; either test-runner guard removed; hours counted with nothing waiting.
- Live `--check` 2026-09-28 08:15 CDT: main 71 commits past staging 0.7.05 (alarm: main-commits), staging 327 commits past prod 0.6.99 (oldest 41 h). Matches Pete's 07:30 measurement.

## Mistakes caught in flight
- A test's control ran the script outside the test runner with a stub gh, but post() prepended /opt/homebrew/bin to PATH, so the real gh came first. It failed only because that HOME had no gh login; #1050 was checked and got no comment. post() no longer rewrites PATH (the plist sets it), and the control's PATH holds no real gh.
- A pointer test's control used spawnSync while the same process served the files, so the child timed out and read could-not-tell for the wrong reason. It now spawns asynchronously and asserts the reason.
