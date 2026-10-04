# loginnotice-5018: the login-expiry notice clears on sign-in, names the account and agents, closes, and floats

Card: joshualeestone/kosmos#5018 (Josh, live 0.7.17 test, 2026-10-02 07:49-07:53 CDT).

## Done means
- After "Sign in again" finishes in Kosmos, the login-expiry notice and the Settings login date are read again on
  the next poll (no app restart). Done for real only once observed on Josh's Mac with the app open.
- Each notice names the provider and the account email ("On Claude, <email>: ..."), or "On Claude:" when the email
  cannot be read; agents are listed by their display names.
- A close X hides a notice until its state changes (severity, days left, expired, account, agent set); per viewer.
- The four top-bar notice slots float over the page, centred under the navigation; the header height and the
  navigation never change while a notice shows, and no notice covers New agent.

## Item 0, cause (measured from source)
status.js caches the advisories 5 min (LOGIN_ADV_TTL_MS) and claudeloginlive caches each account's date 1 min;
nothing invalidates either when a sign-in completes. Josh restarted ~1 min after signing in, so only the restart
cleared it. The new login DID reach the keychain (Settings showed Oct 31 after re-login on the right account).

## Decisions
- **A generation counter in loginexpiry** (loginChanged / loginGeneration), bumped by connect.js writeState when the
  phase becomes CONNECTED. Each cache stores the generation it was read under. Rejected: a listener registry (needs
  modules to require each other; connect -> status would be circular) and a shorter TTL (synchronous tmux/ps/security
  per agent inside snapshot() more often, and still not immediate).
- claudeloginlive: an in-flight read from an older generation is not reused; an older read never overwrites a newer.
- A terminal `claude login` outside Kosmos still waits out the TTL (<= 5 min). Accepted; not Josh's path.
- Dismissal key = severity:daysLeft:expired:credential (a.service):sorted agents, in localStorage (try/catch,
  in-memory fallback, capped at 40). Per-viewer convenience, so browser storage is right. A dismissal is forgotten
  when its credential has no notice at all (the login was renewed), not on any smaller change, so a momentary pane
  read failure cannot bring a closed notice back.
- Overlay: one `.topnotes` wrapper, absolute under the header (header gets position: relative), centred
  (left 50% + translate), z-index 4 so the narrow-width tabs dropdown (z 5) still covers it; in consolidated, where .apphead is static,
  z-index 10 (above the sticky rail at 4, below the reaction picker at 20 and the menus at 40). Pointer-events only on
  the notices. Reverses the 2026-08-17 in-flow decision at Josh's request. On phones the login notice keeps its
  account/names line (it costs no header room now).
- **Centred, not under the K mark** (review round 4, render-update-toast): under the mark the update chip covered
  New agent. The left column holds the page's primary actions (New agent, the agents rail, back buttons); the centre
  holds status text and summary tiles. Rejected: bottom-of-screen toasts (they would cover chat composers).
- scroll-padding-top adds --topnotes-h (the stack's height, from a ResizeObserver), so a focused element scrolled
  into view never lands under a showing notice.

- **Only the login notice gets an X.** The update chip carries its own Install/Reload actions, the update-abort and
  offline notices report a live state that clears itself; an X on a state that is still true would hide the truth.
  Floating means each covers the strip under it (max 460px wide, clicks only on the notice) until it clears;
  render-update-toast checks the chip clears New agent at desktop and phone, and the burger on phone.
- **The X returns the notice when the days count drops** (key includes daysLeft): Josh's card text asks for exactly
  that ("hidden until the state changes: fewer days left ..."). An expired notice is one state (its key does not use the
  falling days count), so once closed it stays closed until the login is renewed or the agents change (round 10;
  earlier rounds had it returning daily, which the card's "hidden until ... expired" does not ask for). A rename of an agent does not bring it back (the key uses system names).
- loginChanged fires on every write of connected (both writers are a person's action: the driver's finish and the
  already-signed-in answer to a start) and also in finishConnected before its race exit, so a landed login is never
  missed. (Round 5 limited it to the move into connected; round 7 showed that missed two real completions.)
- The X's key uses the credential (a.service), not the email, so one failed email read cannot bring a closed notice
  back; the repaint signature adds the email and names so the line still updates.
- **The email rides on /api/status.** Same readers as GET /api/accounts, which already lists every account's email
  for Settings, behind the same board-token gate; no new audience.

- Names and email ride inside the 5-minute advisory cache, so a renamed agent or a changed email reaches the notice
  within 5 minutes (a sign-in refreshes it at once). Cosmetic; accepted.
- A dismissal key with no credential is never pruned, and the X always forces a repaint (round 11: a fixture with no
  service made the X undo itself; real advisories always carry service).

## Sign-in path, traced (review round 2)
Settings > AI Models > a Claude account's "Sign in again" (web `[data-reauth]` -> openAcctReauth -> POST
/api/connect/start {accountDir, reauth: true}) -> server.js -> connect.start({configDir, reauth}) -> the driver ->
finishConnected -> writeState({phase: CONNECTED}) -> loginexpiry.loginChanged(). connect.test.js's end-to-end driver
test asserts the bump on that path.

## Weakest premise
That connect.js's driver is the only way a Claude sign-in completes inside Kosmos (traced below for Settings > Sign in
again). A sign-in outside Kosmos (a terminal `claude login`) still waits out the cache, at most 5 minutes.

## Verification
- engine/loginexpiry-signin-5018.test.js (with a control holding the old value inside the window), connect.test.js
  asserts a finished sign-in bumps the generation; connect/status/login/guard suites green.
- render-login-expiry-3532 (+9 #5018 arms) and render-tophead-stable-2624 (now asserts float; 12 failures on main's
  layout as control).
- Design shots: ~/work/design-shots/kosmos-5018/.
