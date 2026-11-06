# instorb-7896: the Mac installer page shows the KOSMOS orb, not the K loader (kosmos#7896)

## Why
Josh, 11-06 12:17 (verbatim): "basically anywhere we had the K Loader I want it to be the Orb." The page a Mac shows in the browser while the Kosmos .pkg installs (install/pkg-scripts/installing.html, opened by postinstall) carried its own copy of the K loader. The app's own waits became the orb in PR #8123.

## Change
- The mark is the app's whole-screen wait markup: an 88 px `.spin.spin-sweep.orb-wait`, with the K's vertical space kept (the bar starts 97 px below the mark's top, as before).
- KORB is copied into its own script, byte-identical to web/index.html's. The page is standalone (opened before Kosmos runs) and cannot share the app's script. A test compares the two byte for byte, so they cannot drift.
- Only the CSS this page needs: the dots, korb-on, canvas.korb, spin-still, and the reduced-motion pulse. `--spin-dot` is the deep gold #9c741b on the light ground and #d6a62e in the page's dark scheme.
- Settling (the install finished, or Kosmos was already running) holds the orb still (`orb-still`, `spin-still`), as the K was held.
- startKLoader, K_LOAD and CHECK_LOAD are removed. The progress bar, #late, #stuck, #taken, the polling and the open link are unchanged.

## Tests
- install.installing-page.test.js: the markup, the CSS, both golds, KORB byte-identical to the app's (21 of 21 on main after #8123), and the K loader gone. Control: it fails with the markup removed, and fails with one byte of KORB changed.
- Rendered from a copy with the port filled in (Chromium and WebKit, light, dark and reduced motion): ink, the right gold, turning or still, 88 px, the bar 97 px below, and no page errors.
