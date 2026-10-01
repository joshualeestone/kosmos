# #4877: a monitor for the download site, the community site and the relay

## Finished looks like
A scheduled job on Agent1s (every 15 minutes, launchd, beside coordinator-monitor) that alerts within one interval
when anything people download or reach stops answering, and stays silent while healthy:
1. installkosmos.com: for each live pointer (latest.json, latest-staging.json, latest-win.json, latest-win-staging.json)
   every artifact it names (the tarball and its manifest and .sha256 for the Mac; the zip and the versioned zip for
   Windows) answers 200 with the expected content type, every run; and the served bytes hash to the pointer's
   sha256, at most hourly per artifact.
2. community.installkosmos.com: /api/health answers 200 {"ok":true}, and the public feed (/api/posts/feed) answers.
3. The relay: the canary computer address (pizzarama.kosmosplus.com) answers 200.
Alerts go to the same two places as gap-alarm: a pane (Splinter, who routes) by claude-msg, and a comment on
kosmos#4877. Tested against a fake pointer naming a missing file (alarm), a healthy site (silent), and a clear after.

## Pieces
- tools/serve-watch.js: gather (the checks), verdict, the per-channel alert state machine (gap-alarm's, proven over
  12 review rounds: own clock per channel, retry backoff, repost while it lasts, cleared once, weekly "still watching"
  on the card, could-not-tell said only after a grace period, never posts from a test), --check, --plist, --install.
- tools.serve-watch.test.js: a local HTTP server stands in for all three sites through env seams.

## Decisions
- Its own tool, modelled on tools/gap-alarm.js, rather than refactoring gap-alarm's reviewed machinery into a shared
  lib in the same change. Weakest premise: two copies of the alert loop can drift; a follow-up card can unify them.
- A negative control every run: dist/<a name that never exists> must answer 404. A site that answers 200 for
  everything would otherwise pass every artifact check; then the run is "could not tell", not "healthy".
- The relay's build is NOT checked: the relay only writes it to its own journal on the box (crates/relay/src/serve.rs
  "relay up ... build="), with no public route, and this monitor holds no SSH. Said on the card. An unknown name does
  not help either (the relay drops its TLS handshake), so the canary is a real computer: if pizzarama's Mac is off,
  the alert says the relay OR that computer, which one cannot be told from outside.
- Pane goes to Splinter (claudebot-discord:0.0) by default: the site and the relay have different owners, and he routes.
