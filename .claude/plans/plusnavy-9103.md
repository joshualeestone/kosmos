# plusnavy-9103: no navy inside the iPhone app (kosmos#9103; Josh 11-25 16:49, "we are not going to have the blue background anywhere in the app")

Based on PigeonPete's navyweb-9101 (acaa7eeb50, final for web/index.html per him); #9101 merges with or after this.
Done when: inside the app (html.kapptabs) the phone menu (#pnav) and Settings > Kosmos Plus show the board's ground and
ink (--k-bg #faf9f7 light / #0c0d0f dark, gold accents), no navy or blue fill, in light and dark (screenshots via
mobile-shots --app-tabs); Kosmos+ in a browser is unchanged.

## Slice 1 (web/index.html, this branch)
- DONE (WIP commit): #pnav inside the app: ground --k-bg, ink --k-ink, secondary --k-ink-2, error --danger, focus
  rings on ink/rule; the red badge and dot stay red.
- NEXT: Settings > Kosmos Plus. body.plus-active is "the blue skin" (syncPlusChrome) over 27 tokens + a radial
  gradient, with ~67 references (dark-mode rules deliberately skip it). Preferred: inside the app do NOT apply the skin
  (syncPlusChrome: active = plusOnScreen() && !kapptabs) but still mount the section; hide #plus-stars (white stars,
  decorative) in the app; check #plus-mark (the wordmark canvas, recoloured via --spin-gold / KORB) reads on cream in
  light and dark. Decide by screenshots, not by reading.
- Then shots (light + dark, iphone15, --app-tabs) of the menu and the Plus section, a browser control (no --app-tabs)
  showing navy unchanged, review, PR.

## Slice 2 (kosmos-relay, separate PR): the Kosmos+ pages under the app's Close bar
coordinator/src/signin.html (login.kosmosplus.com) and coordinator/src/console.html (account and delete; console is
PigeonPete's reasoned guess). They need an in-app signal from the iPhone app (a query param or header) to drop navy
only there. Relay deploy is separate from a Kosmos cut.

## Progress 18:3x (head 3af99acf55, all pushed)
- DONE: #pnav in the app (shots: light and dark read, no navy); the browser control is still navy.
- DONE: Settings > Kosmos Plus in the app: syncPlusChrome leaves plus-active off when html.kapptabs; #plus-stars hidden
  in the app; the section's own navy-era colours (#s-sec-plus pills, chip, QR caption, store buttons and sash, remove
  link, #plus-state2 wizard fields, OTP cells, hint text) mapped to --k-*/--ok/--danger/--gold; the sign-in's blue
  .uprime is the board's gold primary. Shots ~/work/design-shots/kosmos-9103/app (plus-connected, plus-join,
  plus-signin-email, plus-signing-in, app-header-menu; light and dark) all read, round 2.
- OPEN 1: mobile-shots flags OVERFLOW on plus-connected in the app (.panel 357>345, widest i.plus-sash). The same
  screen on #9101's base (acaa7eeb50) has 0. The sash is clipped visually (.plus-store overflow:hidden), so it is
  probably the checker measuring the rotated box, but something about the panel changed with the skin off: find what
  (compare .panel's scrollWidth and any plus-active-only clipping) before calling it harmless.
- OPEN 2: links ("View account", "Cancel") are the board's normal link colour (blue TEXT, not a fill); left as is,
  since the ruling is about blue backgrounds. Say so in the PR.
- THEN: reshoot round 3 (light lane), blind review, proof, PR into main AFTER or WITH #9101 (coordinate with
  PigeonPete), then slice 2 in kosmos-relay.
