# acctmodal-7202: the account dialog keeps Tab inside it (kosmos#7202)

## The call
- `web/index.html`: a keydown Tab trap for `#acct-add-modal`, beside its Escape handler. While the dialog is open
  and not under another screen that made it inert, EVERY Tab and Shift+Tab is moved by the trap to the next or
  previous stop, wrapping: WebKit's default Tab skips buttons (the Mac app is a WKWebView), so a trap that acted only
  at the ends leaked between them there. Focus behind the dialog (Sign in again for OpenAI opens without moving it)
  goes in on the next Tab. Focus on something inside that is not a stop (the note a failed start focuses) moves to
  the next stop in that direction, in page order, wrapping. Option+Tab too (how WebKit moves between buttons). It
  stands down on a press another trap already handled (defaultPrevented), while another aria-modal dialog shows (it
  opened over this one and its own trap has the keys), and while an input method is composing. Inert is read as the
  property too (where `inert` is unimplemented only the property is set). A radio group is one stop, as the browser
  tabs it.
- Stops are worked out on each key press (`acctAddTabStops`): the dialog's focusable controls that are shown,
  enabled, visible, not inert and have a box, plus the Sign in again ask's buttons when it shows (as first run's trap does,
  #6616), so the ask stays reachable.
- One trap covers every opener (openAcctAdd, openAcctReauth, openAcctReauthOpenai, openAcctReauthGrok), because it
  keys on the dialog being open, not on who opened it. #7198's in-place opener from the login notice is NOT on this
  branch or on main yet; when it lands its opener should join the check's list. Conjunctive risk to check then: if
  its notice slot inerts the dialog's ancestors while it opens the dialog, the dialog is inert and this trap stands
  down entirely.
- `docs/browser-checks/render-acct-modal-trap-7202.js`: hermetic board with one agent; real key presses on the
  Agents tab and on an agent's page for all four openers, in Chromium and WebKit; wired in gated.txt, the README and
  SITE_COUNTS. Reds on origin/main in both engines, and in WebKit on an ends-only trap.

## Rejected
- Making the page behind inert. First run (`frOpen`), its first screen (`frChoiceInert`), the restart screen
  (`restartScreenInert`) each keep their own inert set (and #7198, unmerged, adds one for the login-notice slot), and frClose un-inerts every
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
2. (sonnet) W: the trap stood down on Option+Tab, which is how WebKit moves between buttons, so it walked out (now
   trapped). W: a dialog opened over this one (a removal confirm, a Kosmos+ sheet) had its Tab pulled back here by a
   trap registered first (now this one stands down while another aria-modal dialog shows). W: Tab during IME
   composition was taken (now left alone; no test, Playwright cannot compose). W: every radio was a stop (now a group
   is one, as the browser tabs it; no radio in the dialog today). W: the check never pressed Option+Tab, opened the
   picker's list, showed another dialog or the one-stop success view (arms for each; each reds on the round 1 trap,
   both engines). Not taken: the plan file's name has no timestamp (precedent: muse-acct-3939.md); Shift+Tab from a
   focused container skips its descendants (no focusable container in the dialog).
3. (default model) W: the comment said another dialog's trap "has the keyboard", stronger than true (several act only
   at their ends; now "Tab is left to it", and the arm says why it runs on a step with no field). W: no walk covered
   a step with a text field (now the OpenAI and Grok key steps, password field included). C: the plan named #7198's
   opener as covered though it is not on this branch (now marked pending, with the inert risk to check). Nits taken:
   the IME and inert stand-downs had no arm (now sent key events, with a plain Tab as the control); the radio rule's
   backward case is stated; the defaultPrevented comment named the wrong case; the check picks a provider through the
   picker a person uses, not the hidden native select.
4. (sonnet) W: focus moved by script left a text field's caret where it was, where a native Tab selects its text, so
   Shift+Tab back into a mistyped key and typing appended to it (now its text is selected; arm on both key steps).
   Nits taken: a dialog hidden by visibility no longer counts as showing; summary and contenteditable are stops; the
   defaultPrevented comment no longer overstates. Not taken: the other-dialog arm passes for a trap that stands down
   for any reason (it does discriminate the trap that does not, which is the failure it is for).
5. (default model) B: the check named ids it makes itself (`#trap7202-radios`, `getElementById('trap7202-tail')`),
   which browser-checks-selectors.test.js requires web/index.html to carry, so CI would red (confirmed with the guard's
   own idsAskedFor: two MISS on the old check, none now; the made elements are held on window). Nits taken: Tab from
   the page now must enter at the first stop (was any stop); a Tab another handler already prevented has an arm; the
   header no longer says "every" Sign in again (four openers driven, the rest share the trap). Not taken: stacking
   order between two shown dialogs (no opener sits in a modal today); the auto-update overlay sets no inert or
   aria-modal (pre-existing, outside this dialog); openAcctReauthOpenai leaves focus on its opener (pre-existing; Tab
   now brings it in).
6. (sonnet) W: a dialog left visible (opacity, off-screen) would switch the trap off silently (now every opener arm
   asserts no other dialog reads as showing). Nit taken: `:disabled`, so a disabled fieldset's controls are not stops.
   Not taken, measured: "the other-dialog arm passes with the stand-down deleted" is false; with it deleted the arm
   reds in both engines (focus pulled to the provider picker). Not taken: positive tabindex order (none in the
   dialog); the radio arm guards the every-radio-is-a-stop rule only, as its comment says.
