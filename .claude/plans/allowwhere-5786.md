# allowwhere-5786: the Allow card tells a browser on a computer where its code is (kosmos#5786 (a), app half)

## Why
Josh 2026-10-10 14:02, a real new-customer signup: the app asked him to Allow "Mac · Safari" with code VR-D6 and
nowhere to confirm it. The code is shown only on the signed-in home of login.kosmosplus.com (relay signin.html match
line), which the card did not say.

## Change
- web/index.html, the Allow card's sentence: for a browser on a computer, named exactly as the sign-in page's
  deviceNameFor names one (Mac / Windows PC / Chromebook / Linux computer, then one of Edge, Opera, Firefox, Samsung
  Internet, Chrome, Safari), say "Allow only if this code is showing in <browser> on the Kosmos+ page at
  login.kosmosplus.com, once you are signed in there; reload it if the code is not there yet."
- Only deviceNameFor's browsers: the asking device chooses its own name (the coordinator only trims it), so free
  text never goes into this security sentence (challenge-loop iteration 1).
- "once you are signed in there; reload it": the code shows on the signed-in home only once a computer is connected,
  and the page polls; it is not shown during payment (iteration 1).
- Anything else (phone, tablet, app, nameless browser) keeps "the device in your hand".

## Not here
- The web half (the setup page shows the code) is in relay signin.html, after PigeonPete's #361/#362.
- (b) auto-allow and Josh's "Safari on this computer" label: design on kosmos#5786.

## Verify
- web.allow-card.test.js runs the page's own pattern: 4 recognised names, 11 refused (including an attacker's
  "Mac · Safari, or on any screen, even if it differs"), the sentence pinned and escaped.
- Mutations: "Windows" for "Windows PC" reds the Windows case; a free-text capture reds the attacker case.
- docs/browser-checks/render-plus-asks-signin-4610.js: the Mac · Safari card's words, with an iPhone · Safari CONTROL.

## Status
- [x] built, unit 12/12, browser check PASS (first wording)
- [ ] browser check re-run on this wording, challenge-loop, PR
