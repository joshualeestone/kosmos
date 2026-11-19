# stepupreturn-8728: back from a fresh Kosmos+ sign-in, the page reopens the Claude account it was for

Card: kosmos#8728 part 2, slice 2 (design posted on the card 11-19). Slice 1 is remoteopener-8728 (PR #8747).

## Why
A Claude "Sign in again" pressed from a remote session is refused until the person has signed in to Kosmos+ again
(email code and authenticator) within 10 minutes. The step-up ask at the foot of the page takes them through that sign-in,
and they land back on the board with nothing remembering what they were doing: they must find the account again and press
Sign in again a second time. On a phone that is the step most likely to lose them.

## What changes (web/index.html only)
- `acctAddStart`: when `/api/connect/start` answers the refusal that offers Sign in again (`code === 'remote_step_up'`
  and `signInAgain === true`, the same test the ask uses) for an existing account's re-auth (`ACCT_REAUTH_DIR`), the
  page keeps one note in sessionStorage: `{ kind: 'claude-signin', dir, at }`. Review 1: "still starting"
  (`remote_step_up_unavailable`) and the clock refusal are followed by no fresh sign-in, so they write none.
- Pressing the ask's own Sign in again (a submit of `#stepup-form`, whichever way it goes: the fresh form or the logout)
  marks the note with the time of the press (`markStepUpReturnGoing`, a capture listener). Review 2: a reload alone
  proves no sign-in, so an unmarked note never acts.
- `resumeStepUpReturn`, called only by the boot read below (review 5: not from the page's later account reads, which
  could land over another menu or picker). It acts only on a note whose Sign in again was
  pressed BEFORE this page loaded (`went < performance.timeOrigin`: the fresh sign-in navigated back), at most 10 minutes old and not from the
  future, for an account still listed and not an API-key account, and not while the account dialog or first run is on
  screen (the note is kept then). It reopens that account's dialog (`openAcctReauth`) with "Press Sign in again to sign
  this account in to Claude." and removes the note. Review 3: the words claim nothing about the Kosmos+ sign-in, since
  a log-out can fail (or the form answer an error) after the press and the person reload; a reopen then is harmless,
  because a press just meets the same refusal. Review 1: without the
  page-load rule, any later read in the same view (Settings, an agent panel, a timer) reopened it with a false sentence.
- `stepUpReturnBoot` on load: with a note this page may act on, one `/api/accounts` read, and the resume runs on that
  list without storing it as the page's list (review 2: the page's own reads keep their sequencing). So the return
  happens on arrival rather than when the person next opens Settings. No note, no read. The dialog's return focus is
  reset, since the page opened it, not a control.
- Every Claude start (`acctAddStart`, and first run's `frConnectStartConfirmed`) clears an older note first (review 5:
  a new account's or first run's refusal records the same request key, so an older Claude note would otherwise be
  marked by its press and reopen the wrong account).
- A note the page reads and cannot use (unparsable, wrong shape, past its window) is removed (review 5).
- `acctAddStart` reads the folder into a local before its awaits, and the note uses that (review 3: another account's
  dialog opened while the request was out would otherwise be named in the note).
- Not now on the step-up ask forgets the note. Closing the account dialog does not: the ask at the foot is still the way
  to the fresh sign-in.

## Rejected
- Starting the sign-in by itself on return: a write the person did not press, and a stale note must never act.
- localStorage: it would outlive the tab and could reopen a dialog on a later visit.
- A new route to ask "would this be refused?" before the first press: the refusal plus the remembered return covers it.

## Weakest premise
That the gate's sign-in brings the person back to this same tab. If it lands in a new tab the note is not there, and the
flow is today's (no worse).

## Weakest premise, second (review 1)
That the person goes through the ask's Sign in again in this tab within 10 minutes. If they close the tab, or sign in
elsewhere, the note expires unused.

## Known and left (review 4)
- A tab duplicated after the press copies sessionStorage, so that copy can reopen the dialog too (each tab uses its own
  copy once). The page acts in a tab the person opened from this one, never another visit or another viewer.
- An account read that does not list the account uses the note up: the person falls back to today's flow.
- A note kept because the account dialog or first run was on screen at the boot read is not resumed later in that page
  view; it expires. The 10 minutes count from the refusal, not from the press.
- The mark is tied to the refusal by the ask's own record of the refused request (`stepUpFor`), so Sign in again pressed
  for another refused write does not mark the Claude note.

## Tests
`web.stepupreturn-8728.test.js` (functions lifted, stand-in sessionStorage, performance and fetch): after a page load a
note whose Sign in again was pressed reopens its account once and resets the return focus; in the same page view it
never acts and is kept; a reload without a press, or a press in the same view, opens nothing (review 2); over an open dialog or first run it
waits and is kept; a note over 10 minutes old, from the future, for an unlisted or API-key account opens nothing
(CONTROL: just inside the window does); other shapes are ignored; Not now forgets; blocked storage breaks nothing; boot
reads the list once only with an actionable note (CONTROLs: no note, a same-view note); and the wiring points, including
that only the Sign-in-again refusal writes a note. Existing tests that name the touched functions
(web.accounts-add, web.flowpoll-4275, web.reauth-1492, web.switch-account-1373) pass: 86 with the new file and the three tests that name frConnectStartConfirmed (server.confirmstale-1574, web.connect-confirm, web.firstrun-model).
