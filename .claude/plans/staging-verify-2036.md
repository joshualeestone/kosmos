# kosmos#2036 — the VERIFICATION half of the staging gate

Scoped to Ice Cream Kitty by Splinter (2026-09-03). Baron owns the staging CHANNEL
(publish-to-staging, promote-the-same-artifact, rollback as a pointer change — `release.sh`,
his lane). Josh owns the fresh-state machine. This card is: **what must be true of a build
before it is promoted, and the check that proves it.** It can be specified and built before a
channel exists to run it in, because the verification is what decides whether the channel is
worth having.

## The two traps at the centre, because they are what actually failed

**Trap 1 — a fresh INSTALL and a successful UPDATE produce the same final version string and
are different tests.** 0.6.25 shipped a correct fix, was verified four ways, and only the
UPDATE path broke (#2023). A check that installs fresh and asserts "version is 0.6.25" passes
while every updated machine is dead. ⇒ **The verification must actually PERFORM an update from
a real prior version, not install fresh and read the version.** "Updated-from" is a property
the test PROCEDURE guarantees (install X, then update to Y), not something a post-hoc check can
read back — `autoupdate.js` records only the on/off setting, and both paths end at the same
version, so there is no after-the-fact trace that distinguishes them. The guarantee is: the
harness installed a prior version first and drove the real update.

**Trap 2 — "did it update" is not the acceptance either.** 0.6.26 updated correctly and the
user was still broken, because the fix reached the browser and he opens the app. ⇒ **The
acceptance is "can the person USE it, on the surface they actually open," not "did the version
change."** For today's defect class that surface is the board in a browser that holds no
cookie: #2023 was a no-cookie browser 403ing every `/api/*`, and #2030 is the self-heal (the
enforcing update opens the browser once, `?boot=` redeems, the durable cookie lands). So the
experience assertion is: after the update, a browser that started with NO `kosmos_board`
cookie ends up authenticated and the board's `/api/*` succeed — the #2030 flow completed.

⚠️ **A bare no-cookie `curl` to `/api/*` returning 403 is enforcement working correctly, not
the bug** — so the experience check is NOT "curl without a cookie and expect 200." It must
drive the actual auto-open + `?boot=` redemption the way a person's browser does, and assert
the RESULT is a working session. This is why the experience half needs a browser, not a fetch,
and why no artifact check can reach it (the artifact half is `#2004`'s
`verify-install-funnel-offlan.sh`, already built).

## The fresh state — a new macOS user account, not new hardware

The state our verification has never had is: no board token, no cookie, no prior install, no
`Kosmos.app`. Our own accounts structurally cannot provide it (they all hold the credential),
and the fleet Mac cannot even test auto-update at all — it runs a from-source checkout
(`node .../server.js`), which `update.js:157` never auto-installs over. A **new macOS user
account on an existing Mac** is genuinely fresh for install state, is free, and is creatable in
a minute. ⇒ **Proposed to Josh as the cheap fresh-state option before anyone budgets hardware.**
Account creation on his machines is his call, not an agent's.

⚠️ **Named limitation, so it is not discovered later:** a fresh ACCOUNT is fresh for install
state but shares the MACHINE — same LAN, same resolver. So it catches the install/update/
experience class (what broke today) but CANNOT catch anything that depends on a genuinely
different network vantage. That is the exact residual `#2004` identified as needing a
residential-ISP vantage (cabal9 / Casey's mini). The two are complementary: the fresh account
is the experience vantage, the off-LAN machine is the network vantage.

## The check, in three parts

1. **Artifact identity (DONE, reuse #2004).** `verify-install-funnel-offlan.sh` confirms the
   staging pointer and the prod pointer serve the byte-identical artifact (magic + sha256 vs
   sidecar). This is requirement 3 ("promote the SAME artifact, no rebuild") verified for free.
2. **Updated-from (procedure-guaranteed).** The harness, on the fresh account: installs a real
   prior released version, confirms it is running, THEN updates to the staging build under test.
   The guarantee is the procedure, not a flag. It additionally asserts the running version
   changed to the build under test after the update (necessary but not sufficient — trap 2).
3. **Usable-on-the-surface (the experience half, browser).** From a browser profile with no
   `kosmos_board` cookie, after the update: the board's bookmarked URL loads AND `/api/*`
   succeed — i.e. the #2030 auto-open + `?boot=` redemption completed and the durable cookie is
   present. A red here is exactly #2023. This is a person "doing some polymer clicking," or a
   headless browser check driving the same flow.

## What this must NOT become

A ceremony that adds a day to every cut. Today's fix needed to ship fast and did. The gate is
crossable in minutes by one person (or one browser-agent) on one fresh account: install prior,
update, open the board, confirm it works. And it does NOT replace the outside testers (Ben,
Morpheus) — staging catches what we can predict; they catch what we cannot.

## Build order and dependencies

- **Buildable now (this card):** the experience check as a committed, testable script in the
  repo idiom (exit 0 usable / 1 broken-like-#2023 / 2 cannot-tell, with an override so its ALARM
  can be fired in a test — the `board-serving-check.sh` pattern). It asserts the post-update
  no-cookie board reaches an authenticated `/api/*`. Validated against a live board's flow.
- **Dep — Baron:** the staging channel + promotion in `release.sh`. The verification runs on the
  staging build BEFORE promotion.
- **Dep — Josh:** a fresh macOS account (or the go-ahead to script its setup). The check runs IN
  that account.

## Related

- #2023 (the outage), #2004 (the artifact half + the network-vantage residual), #2030 (the
  self-heal the experience check confirms fired), #2051 (app self-auths its WKWebView — the
  app-surface analog of the browser experience check).
