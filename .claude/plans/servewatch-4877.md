# #4877: a monitor for the download site, the community site and the relay

## Finished looks like
A scheduled job on Agent1s (every 15 minutes, launchd, beside coordinator-monitor) that alerts within one interval
when anything people download or reach stops answering, and stays silent while healthy:
1. installkosmos.com: for each live pointer (latest.json, latest-staging.json, latest-win.json, latest-win-staging.json)
   every artifact it names (the tarball and its manifest for the Mac; the versioned zip, and for latest-win.json the
   fixed-name zip, for Windows) answers 200 with the expected content type and its .sha256 sidecar agrees with the
   pointer, every run; the names are the ones the installers derive from version and arch; and the served bytes hash
   to the pointer's sha256, re-read when the pointer or the file's headers change, after a failed read, and daily.
   Also /setup, the tmux bundle and the generic fallback tarball, which every install fetches.
2. community.installkosmos.com: /api/health answers 200 {"ok":true}, and the public feed (/api/posts/feed) answers.
3. The relay: a computer name that never exists (serve-watch-canary.kosmosplus.com, over plain http) answers with
   the relay's own "Mac not connected" page, so the relay process itself is checked whatever computer is on.
Robustness: a request with no answer or a 5xx is tried once more in the same run; an alarm's identity is the file and
the class of failure (not the error text), so a changing error does not repost every run. A sha or sidecar that
disagrees with its pointer must be seen on two runs in a row (a promote writes the zip, its sidecar and the pointer
one by one). The download site not
answering is an alarm at once, unless nothing else answered either (this computer is offline: could not tell).
Alerts go to the same two places as gap-alarm: a pane (Splinter, who routes) by claude-msg, and a comment on
kosmos#4877. Tested against a fake pointer naming a missing file (alarm), a healthy site (silent), and a clear after.

## Pieces
- tools/serve-watch.js: gather (the checks), verdict, the per-channel alert state machine (gap-alarm's, proven over
  12 review rounds: own clock per channel, retry backoff, repost while it lasts, cleared once, weekly "still watching"
  on the card, could-not-tell said only after a grace period, never posts from a test), --check, --plist, --install.
- tools.serve-watch.test.js: a local HTTP server stands in for all three sites through env seams.

## After merge
`node tools/serve-watch.js --install` from the MAIN checkout on Agent1s (as gap-alarm), then confirm the first run's
log line and that a --check is healthy. The job then runs beside coordinator-monitor.

## Decisions
- Its own tool, modelled on tools/gap-alarm.js, rather than refactoring gap-alarm's reviewed machinery into a shared
  lib in the same change. Weakest premise: two copies of the alert loop can drift; a follow-up card can unify them.
- A negative control every run: dist/<a name that never exists> must answer 404. A site that answers 200 for
  everything would otherwise pass every artifact check; then a run where nothing fails is "could not tell", not
  "healthy", and a run where something still fails (a 404, a wrong type, broken JSON, a sha) is an alarm (round 9).
- A problem stays in the standing alarm until it has been gone an hour, and the all-clear comes once everything has
  been gone an hour (round 11; rounds 9 and 10 counted runs, which only absorbed a problem flapping every other run).
  A post goes only when a problem appears that the last post did not carry, or on the 6-hour repost; a shrinking
  set updates quietly. So a flap on any cycle under an hour is one post. Rejected: run counts (a 1-in-3 flap posted
  about 64 times a day). Weakest premise: the all-clear now waits an hour, and the alarm text lists only this run's
  problems, so a held one is not named while held.
- A fault inside the checks is "could not tell", posted after the same hour's grace, not a silent exit (round 11).
- The relay's build is NOT checked: the relay only writes it to its own journal on the box (crates/relay/src/serve.rs
  "relay up ... build="), with no public route, and this monitor holds no SSH.
- The relay canary is a name that never exists, answered by the relay's own listener (crates/relay/src/redirect.rs),
  not a real computer. Rejected: pizzarama (the card's suggestion), which is Josh's Windows PC: it sleeps, and every
  sleep would alarm. Weakest premise: this checks the relay's http listener, not the https path a person's browser
  takes through it to their Mac (that path's certificate is #4878).
- Re-hash on change, not hourly: the card said "at most hourly"; this re-reads the bytes when the pointer's sha or
  the file's etag/length changes, after a failed read, and once a day. Rejected: hourly (about 140 MB an hour of
  download-site egress, about 100 GB a month). Weakest premise: a same-length corruption behind an unchanged etag
  waits up to a day; the sidecar the installers check is still compared every run.
- Also watched, beyond the pointers: /setup, the tmux bundle and the generic fallback tarball (each tarball against
  its own sidecar), because every install fetches them (install/setup.sh). Not watched: a Windows setup.ps1 at the
  site root (none is served there). Pointer names must be the ones the installers derive from version and arch.
- Two hosts: the Windows files (pointers, zips, sidecars) are redirected to R2, so a second negative control of the
  Windows zip shape (kosmos-0.0.0-win-x64.zip) must 404 there too.
- Records are kept, not pruned, in a run where any pointer could not be read (which files it names is unknown then).
  A file served with no etag, last-modified or length is re-hashed every run (a replaced file could not be told apart).
- Not covered: the installers fetch the tmux bundle and the fallback tarball with a `?v=<version>` cache-buster; this
  fetches the bare URL, so a CDN copy stale at only one of the two would show in only one.
- Pane goes to Splinter (claudebot-discord:0.0) by default: the site and the relay have different owners, and he routes.
- Note: Vercel's last-modified changes on every site deploy, so every deploy re-hashes every artifact once.
