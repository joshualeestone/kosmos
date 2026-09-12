# win32-update-check: an honest update check on Windows, no install (updater slice S1)

Branch `win32-update-check`, off main `f120a6e2`. This is slice S1 of the Windows in-app updater
design (capability 7). It adds no install code: `SELF_INSTALL` stays `['darwin']`, and the
install route still refuses on Windows.

## The bug

A Windows board checks the MAC pointer.
- `engine/update.js` `refresh()` fetches `latest.json` on every platform.
- On main that file names 0.6.59 for arm64, while `latest-win.json` names 0.6.55.
- The wrong answer is hidden only because `installedRoot()` is null on Windows. It looks
  for `runtime/bin/node`, and the Windows bundle ships `runtime\node.exe`.
- That same null makes the status payload send `update: null`. After a Check press, the
  Settings card says "Up to date." even when a newer Windows build is published.
- So a Windows user is never told that a new Windows build exists.

## What changes

1. **`pointerFor(platform, channel)` in `engine/update.js`** is the ONE rule for which file
   is fetched. `refresh()` calls it:

   | | prod | staging |
   |---|---|---|
   | win32 | `latest-win.json` | `latest-win-staging.json` |
   | darwin (and anything else) | `latest.json` | `latest-staging.json` |

   The Mac arm is today's `updatePointer()`, unchanged.

2. **`readManifest(platform, body)`** validates the fetched body per platform.
   - **Mac:** today's rule, unchanged. The body needs a string `version` in numeric x.y.z
     form; the result is `{version}`.
   - **Windows:**
     - `version` is numeric x.y.z;
     - `sha256` is 64-character hex;
     - `versioned === kosmos-${version}-win-${arch}.zip`, where `arch` is THIS machine's
       arch (`process.arch`). A build for another arch therefore fails the name check and
       is not offered.
     - `artifact`, the moving alias, is never read.
     - The result is `{version, sha256, versioned}`.
   - Anything else is null. A null is `readable: false`: no offer, and the card says it
     could not read the answer, never "Up to date". A malformed version still never wins
     (`newer()` is untouched).

3. **The cache stores the manifest.** `cache.latest` is the validated object (or null), not
   a bare version string.
   - `available()` still returns `{version}`.
   - `checkNow()` still answers `latest: <version string>`, so the route's wire shape does
     not change.
   - **Design finding 8 falls out here.** `setupUrl()` already read
     `cache.latest.version`, which was always undefined while `cache.latest` was a string,
     so the `?v=` cache-buster never applied. With the object cache it applies.
   - This is the ONE Mac-visible change: the installer URL gains `?v=<version>`, which is
     exactly what that code's comment intended (the 0.5.13 edge-cache wedge). It is pinned
     by a test that reds on the old string cache.

4. **Choosing a channel and a base.**
   - **Channel:** prod is the default, and staging applies only with the value `staging`.
     - Mac keeps both names, with `AGENT_WORKFORCE_UPDATE_CHANNEL` winning over
       `KOSMOS_UPDATE_CHANNEL`, as today.
     - Windows reads ONLY `KOSMOS_UPDATE_CHANNEL`. Every `AGENT_WORKFORCE_*` variable counts
       as a launch override there (`server.js` `LAUNCH_ENV_OVERRIDES`,
       `win32handoff.overriddenBy`), so it must not be the Windows opt-in.
   - **Base:** `AGENT_WORKFORCE_RELEASE_BASE || KOSMOS_RELEASE_BASE ||
     https://installkosmos.com/dist`, on every platform.
     - The old name is kept, and kept first, everywhere. `server.test.js`, the
       browser-check sandboxes and `engine/selfcheck.js` point the board at a dead host
       through it, so dropping it on Windows would let those runs fetch the real site.
       Nobody is told to set it on Windows: it is an existing test seam, not a new opt-in.
     - `KOSMOS_RELEASE_BASE` is the name `install/setup.sh` reads.
     - Both are resolved when read, not frozen at require.
   - **No fallback:** exactly one URL is fetched per look. A staging pointer that cannot be
     reached, or is unreadable, is that look's answer: no offer, and never a retry against
     prod.
   - **Channel in status:** `updateChannel` rides `/api/status`, and the check route
     answers `channel`.
   - **Boot log:** the board writes one line at boot naming the channel and the pointer URL:
     `Kosmos update check: channel=<c> pointer=<url>`.

5. **The manual offer (Windows, before arming).** `update.manualOffer()` returns
   `{version, download}` only when all three hold:
   - the platform is win32;
   - this is a Windows bundle (`win32board.bundleRoot()`, required lazily so `update.js`
     does not pull the anchor/store chain in at load);
   - `available()` is truthy, which is the same `newer()` gate the Mac offer rides.

   The `download` URL is built from the base the check used:
   - prod gives `${base}/kosmos-win-${arch}.zip` (the alias the site's button serves,
     `https://installkosmos.com/dist/kosmos-win-x64.zip` by default);
   - staging gives `${base}/${versioned}`, the staged pinned zip.

   The alias name is derived from the arch here, not read from the manifest's `artifact`.

   On the wire:
   - `/api/status` carries `updateManual`, and the check route carries `manual`.
   - `update` / `offer` stay `installedRoot() ? available() : null`, so the Install toast
     and button are never drawn on Windows, and the install route's refusal stays the only
     answer to a POST there.

6. **The Settings card** (`paintUpdateCard` in `web/index.html`) gains a manual arm, after
   the install-offer arm.
   - The line reads: "Version <v> is ready. Download it, unpack it over your Kosmos folder,
     then double-click Kosmos.exe."
   - The Check button is hidden, and a `Download` link (`#upd-download`, a real `<a>` to the
     manual offer's URL, opened in a new tab) is shown.
   - A new `#upd-channel` tag reads "Staging channel" and shows only when the channel is
     staging.
   - The other arms are unchanged. "Up to date." still needs reached + readable + no offer +
     no manual offer, and an unreadable or unreachable look still names the failure.
   - All three callers pass the two new status fields.

## Not in this slice (left for S2-S4)

- **No toast on Windows yet.** The toast is the Install toast. A manual-offer toast is UI for
  the arming slice (S4), which replaces the manual offer with a real Update.
- **`installedRoot()` still has no win32 arm.** It gains one in S4, as the design says.
- **No download, verify, stage or swap.** Those are S2 and S3.
- **The Windows staging channel does not exist server-side yet** (S0). Until it does, a
  staging-channel Windows board correctly says it could not read the answer (a 404 is
  reached but unreadable).

## Tests (each red when its change is reverted, with a control)

- **`engine/update.win32-check.test.js`** (new) covers:
  - `pointerFor` by platform and channel;
  - Windows manifest validation (a bad version, sha, versioned name, another arch, or an
    `artifact`-only body gives no offer and readable false);
  - the channel env names per platform;
  - `KOSMOS_RELEASE_BASE`;
  - staging unreachable gives one fetch, of the staging pointer only, and no offer;
  - `manualOffer` prod and staging URLs;
  - no manual offer off a Windows bundle;
  - the `setupUrl` cache-buster (finding 8).
- **`engine/update.test.js`** now pins `darwin` through the new platform seam, so the Mac
  contract stays pinned on any host. It needs this because this suite also runs on the
  Windows box.
- **`web.win32-update-offer.test.js`** (new) chains the engine output from a Windows-bundle
  check into the REAL `paintUpdateCard`:
  - a newer Windows build is never "Up to date"; it shows the manual sentence and link;
  - current shows "Up to date.";
  - a bad manifest gives the could-not-read sentence;
  - staging shows the tag;
  - a source pin checks that the status route and the check route carry the fields.
- **`engine/update.win32-570.test.js`** still passes: the install still refuses on Windows.
- **`docs/browser-checks/render-update-win32-manual.js`** (new) asserts the manual-offer text
  and link, "Staging channel", and the couldn't-check state against stubbed routes.
  Playwright is not installed on the Windows box, so it gets `node --check` only there.
- **No real fetches:** every fetcher is stubbed, and no test fetches the real site.
