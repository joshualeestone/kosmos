# acctmodal-7202: the account dialog keeps Tab inside it (kosmos#7202)

## The call
- `web/index.html`: a keydown Tab trap for `#acct-add-modal`, beside its Escape handler. While the dialog is open
  and not under another screen that made it inert, Tab from the last stop goes to the first and Shift+Tab from the
  first goes to the last. Focus behind the dialog (Sign in again for OpenAI opens without moving it) goes in on the
  next Tab. Focus on something inside that is not a stop (the note a failed start focuses) moves to the next stop in
  that direction, wrapping.
- Stops are worked out on each key press (`acctAddTabStops`): the dialog's focusable controls that are shown,
  enabled, not inert and have a box, plus the Sign in again ask's buttons when it shows (as first run's trap does,
  #6616), so the ask stays reachable.
- One trap covers every opener (openAcctAdd, openAcctReauth, openAcctReauthOpenai, openAcctReauthGrok, and the
  login notice's in-place opener from #7198), because it keys on the dialog being open, not on who opened it.
- `docs/browser-checks/render-acct-modal-trap-7202.js`: hermetic board with one agent; real key presses on the
  Agents tab and on an agent's page for all four openers; wired in gated.txt, the README and SITE_COUNTS. Reds on
  origin/main (32 of 70, every leak arm on every opener and page).

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
