# plusloader-5785: the big K-to-circle loader while Kosmos+ connects this computer

Card: #5785 (Josh, #admin 2026-10-10 14:00: "if this screen is going to take a while to load (it did) lets use the big
animate K-to-circle animation"). Owner: April, routed by Splinter.

## Measured first (coordinator log, 5.161.109.18, read-only journalctl)
Josh's in-app sign-in, 2026-10-10 (UTC): session 18:59:48.8, computer registered 18:59:49.6, ACME challenge DNS wait
24.07 s (ended Seen, 19:00:16.6), certificate 19:00:21.8, relay ticket 19:00:22.1. About 33 s; the DNS wait is ~73%.
All 7 ACME waits since 2026-09-01: 24.03 to 24.09 s. That is acme.rs's DNS_SETTLE (20 s after two sightings 2 s apart,
#4616), a deliberate margin for Let's Encrypt's other regions, not slow DNS. Follow-up only (see the card).

## What
- Settings > Kosmos+ sign-in card (#plus-state2): a holder above the heading. While a register runs (the automatic one
  and a typed name alike: both wait on the same certificate), mount the restart interstitial's canvas (176x206, shown at
  88x103) there and drive it with startKLoader, the existing branded loader (#2692/#2831). No new component.
- The small .spin-sweep beside "Connecting this computer as" stays for the short "Checking your Kosmos+ addresses" read
  only; during the register it stays hidden (the big loader replaces it).
- Hold: at least RESTART_HOLD_MS (one whole K-into-circle loop) before a SUCCESSFUL answer is shown, with the same test
  seam (window.__kosmosRestartHoldMs), so a fast connect does not flash. A refusal or error shows at once (review 2).
  Through the hold the register counts as running (PLUS_SI_REGISTERING, both kinds) and an answer held past a Sign out
  or Start over is dropped (review 1).
- Centred while it connects, with "This takes about half a minute." under the address (Mona Lisa's review; measured
  ~33 s; the engine allows up to five minutes, so it is a typical figure, not a promise).
- Teardown: the canvas is REMOVED (holder emptied) on the answer and on any step change; startKLoader stops its rAF loop
  when its canvas leaves the DOM, so hiding would leave it drawing.
- Heading "Signing in..." and the "Connecting this computer as <name>.kosmosplus.com..." line stay, under the animation.

## Not here
Speeding up the 24 s DNS settle (coordinator, kosmos-relay). Filed as a note on the card.

## Weakest premise
That holding the result up to 4.4 s on a fast connect is better than a flash (Splinter's call from #2692's rule); a
connect is ~33 s in practice, so the floor almost never applies.

## Tests
web source test: the holder sits above the heading in #plus-state2; the register mounts a canvas and calls startKLoader;
the hold uses RESTART_HOLD_MS and the seam; the step change and the answer empty the holder; the small spinner is not
shown during the register. A browser check of the live loader via design shots (light/dark, desktop/phone).
