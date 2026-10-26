# acctmodal-7202: the account dialog keeps Tab inside it (kosmos#7202)

## The call
- `web/index.html`: a keydown Tab trap for `#acct-add-modal`, beside its Escape handler. While the dialog is open
  and not under another screen that made it inert, EVERY Tab and Shift+Tab is moved by the trap to the next or
  previous stop, wrapping: WebKit's default Tab skips buttons (the Mac app is a WKWebView), so a trap that acted only
  at the ends leaked between them there. Focus behind the dialog (Sign in again for OpenAI opens without moving it)
  goes in on the next Tab. Focus on something inside that is not a stop (the note a failed start focuses) moves to
  the next stop in that direction, in page order, wrapping. A press another trap already handled (defaultPrevented)
  is left alone, and inert is read as the property too (where `inert` is unimplemented only the property is set).
- Stops are worked out on each key press (`acctAddTabStops`): the dialog's focusable controls that are shown,
  enabled, visible, not inert and have a box, plus the Sign in again ask's buttons when it shows (as first run's trap does,
  #6616), so the ask stays reachable.
- One trap covers every opener (openAcctAdd, openAcctReauth, openAcctReauthOpenai, openAcctReauthGrok, and the
  login notice's in-place opener from #7198), because it keys on the dialog being open, not on who opened it.
- `docs/browser-checks/render-acct-modal-trap-7202.js`: hermetic board with one agent; real key presses on the
  Agents tab and on an agent's page for all four openers, in Chromium and WebKit; wired in gated.txt, the README and
  SITE_COUNTS. Reds on origin/main in both engines, and in WebKit on an ends-only trap.

## Rejected
- Making the page behind inert. First run (`frOpen`), its first screen (`frChoiceInert`), the restart screen
  (`restartScreenInert`) and #7198's login-notice slot each keep their own inert set, and frClose un-inerts every
  body child wholesale. A page-wide inert set added here would have to be kept from undoing theirs and from being
  undone by them. A trap sets nothing, so it has nothing to give back.
- A focusin backstop (pull stray focus back into the dialog). First run already pulls stray focus to its heading;
  two pulls on one focus move would fight. Keydown only.

## Weakest premise
- A Tab trap does not stop a screen reader's virtual cursor reading the page behind; `aria-modal="true"` (already on
  the dialog) is what asks it not to. If a reader that ignores aria-modal matters, the inert route has to be built
  with the give-back-only-what-you-set discipline, and this trap stays as the keyboard half.

## What would change my mind
- The dialog opening while first run is up and not inert (today frOpen makes it inert, and the trap stands down on
  an inert dialog, so first run keeps the keyboard).

## Review rounds (blind)
1. (default model) B: the trap acted only at the ends, and WebKit's default Tab skips buttons, so in the Mac app
   Tab left the dialog between them (now every Tab is moved; the check runs WebKit and reds 9 on the ends-only
   trap). W: the ask's buttons sit far from the dialog in the page, so a default step from either left (fixed by the
   same change; the check now shows the ask). W: the check ran Chromium only (now both). W: the note arm could not
   fail, since a stop follows the note (now a non-stop after the last stop, both directions, and Shift+Tab from the
   note). Nits taken: stand down on a press another trap handled; skip visibility:hidden controls; read inert as the
   property too.
