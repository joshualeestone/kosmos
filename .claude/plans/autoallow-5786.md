# autoallow-5786: the board half of kosmos#5786 (b), automatic Allow of the browser this computer opened

## Why
Josh 2026-10-10 14:02, his own signup: signed up in Safari, signed in to Kosmos+ in the app on the same Mac, and was
asked to Allow "Mac · Safari" with a code he could not find: "this should automatically just allow since i am on this
computer". Ruled 19:04: "Let's ship the auto allow thing per you and kitty's recommendation" (residual accepted: a
hacked coordinator could admit one device within ~10 minutes of app sign-in; stated on the card and in the relay
docs).

## Contract (kosmos#5786 comment 6102473301; relay branch vouchcoord-5786, Baron's tunnel half vouch-5786)
S = 32 random bytes, base64url (43 chars). Browser opened at `<coordinator origin>/#allow=S`. The page sends
HMAC-SHA256(key = UTF-8 of S, msg = UTF-8 of its device id), unpadded base64url. The tunnel's pending.json carries it
as `vouch` (absent = no auto-allow).

## Change (engine/remote.js, web/index.html, one new browser check)
- After a successful sign-in (fresh register and the already-this-computer path): mint S in memory only, 10-minute
  window, a 3 s timer while live; Forget, Sign out and switching off stop it.
- Open the default browser (runCompanyOpener) at the coordinator origin #allow=S, ONLY once the snapshot holds a
  phone or browser request from the last 30 minutes, so an app-only sign-up never gets a stray tab. https, or http on
  loopback only.
- Allow the ONE row whose vouch equals HMAC(S, its id), constant-time; never a joining computer (joining_computer or
  code_wait), never this computer's own sign-ins; spend S on the first allowed match.
- Note it in remote.json `vouched` ({id: {at, name}}, newest 20): pendingDevices().connected_here (10 min) and
  devicesList on_this_computer; Remove (the Undo) drops the note.
- Page: "<Browser> on this computer is connected." with why, Undo (Remove) and Got it; Devices list "on this computer".

## Verify
- engine/remote.test.js #5786 (7 tests): opens only with a recent eligible request; allows by vouch once, notes it and
  clears the remembered address; wrong vouch / swapped id / joining computer / own sign-in (vouch-path name) never
  allowed, with a positive arm; Undo drops the note; Sign out, switch-off, an hour-old request and a plain-http
  coordinator; a no-session Try again mints nothing; a Not-me device is never allowed and a refused allow stops after
  three tries; a timed-out remove keeps the note. Mutants for each guard red their own test (iterations 1-3).
- docs/browser-checks/render-connected-here-5786.js (new) + the three existing ask checks (surface gate), headless,
  through queued-heavy.
- Page tests that touch the ask code pass.
