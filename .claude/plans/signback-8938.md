# signback-8938: Sign in again brings a member back to the invite sheet (kosmos#8938 item 4)

Source: the live Cloud member walk for #7973 (11-23). A member whose outside invite was refused for an old sign-in
pressed Sign in again and landed on a fresh page with what they had typed gone. Items 1 to 3 of #8938 merged as #8942.

## Done when
A member on a remote session whose "Make an invite code" is refused with remote_step_up + signInAgain, who presses
Sign in again and comes back, finds Projects open on that project with the invite sheet showing who it was for and
person or agent as they had them, and the line "Your invitation is filled in again. Press Make an invite code." The
code is never made by itself. A project that is gone, a reload with no press, or a refusal with no Sign in again
opens nothing.

## Design
- Reuses #8728's one tab note (sessionStorage `kosmos-stepup-return`, 10 minutes, acted on only on the load after the
  press). New kind `fed-invite`: { project, label (80 max, the sheet's own limit), invitedKind, at }. No email, no
  code. Decided: the optional email is not carried (it is the one field that identifies a person outside; retyping
  it costs little, keeping it in storage costs more). The note keeps only `hadEmail: true` when one was typed, so the
  sheet says "Your invitation is filled in again, except the email address. Add it again if only they should use the
  code." with focus on that field, never on Make (review 7: Enter there would make a code anyone can use).
- `markStepUpReturnGoing` marks a note only for its own request: `POST /api/connect/start` for a Claude note,
  `POST /api/federation/invite` for an invite note. One `stepUpNoteShaped` decides both shapes.
- `resumeStepUpReturn` (the account list) ignores an invite note. `stepUpReturnBoot` routes an invite note to
  `fedInviteReturnWait` (no account read).
- `resumeFedInviteReturn` waits (note kept) while first run or any `.rm-back` dialog is on screen, until the projects
  read has landed (in the tab layout projects are read only on Projects, so it asks for that read itself, one at a
  time, at most 3 times), and until inviting is on (fedShow). Then the note goes; a project no longer listed opens
  nothing; else showTab('projects'), openProject, fedInviteOpen(null, { label, kind }), and the line. 60 tries,
  one now and then every 500 ms. If the person presses or types anything meanwhile (outside first run), they have moved
  on: nothing opens and the note goes.
- Each new attempt forgets only a note of its own kind (forgetStepUpReturnOfKind): a Claude start never erases an
  invite note, and an invite attempt never a Claude one. A second Make that fails for another reason leaves the first
  refusal's ask up with no note behind it (Sign in again then returns nothing): accepted, the person is already on the
  sheet.
- A press or key while anything covers the page does not count as moving on (dismissing first run or a dialog is not a
  choice of where to go); the return waits behind both.
- Busy is the board's own: stepUpReturnBusy (first run, the account dialog) or tipModalOpen (dialogs, the first
  screens, an update or restart screen, an open <dialog>, the phone menu). Reused rather than restated: CI selects
  browser checks by the selectors and names a page diff's lines contain, and restating them selected 291 of them and
  ran the job past its 2-hour limit (PR #8947, first run). Known edge: a dialog left open inside a hidden section
  makes the return wait (it keeps the note), the safe direction. An archived project opens nothing.
- Known limit: a Make whose sheet is force-closed while it is answered (federation turning off) writes no note, so
  that refusal's ask returns nothing. Rare: the sheet refuses to close while Make is in flight.
- Known limit: presses are watched only during the 60 tries. A later reload inside the note's 10 minutes, after the
  person worked elsewhere, still opens the sheet once.
- Known limits from review 7: (a) measured in the tab layout only; in the consolidated layout the board may auto-open
  its first project on the return's projects read, and the return then switches to the noted one. (b) Sign in again
  the logout way lets another Kosmos+ account sign in in the same tab within the 10 minutes; if it also lists the
  project, it sees the first person's "Who is it for?" filled in. (c) On a phone a touch to scroll is a press, and so is
  a Tab key, so either ends the return (which usually acts within a second).
- Decided, from review 8: with no email typed, focus stays on Make (as the expired row's "Make a new code"): Enter
  there makes exactly the invitation the person asked for before the refusal.
- Decided, from review 2: a page whose 3 projects reads all fail opens nothing (the note stays for a reload). That is
  today's behaviour, and more reads would poll a board that is not answering.
- The words claim no sign-in (#8728 review 3: a log-out can fail and the person reload).
- fedInviteMake and pjMintInvite clear an older INVITE note before their request (forgetFedInviteReturn), never a
  Claude note, whose ask may still be on screen. pjMintInvite (the create form) never writes one: it has no sheet to come back to.
- Renet's nit 1 on #8942: plusOrgSeesText drops ONE closing full stop per line (not one ending an ellipsis, and the space before it) before
  joining, so no ".;".

## Tests
- web.fedinvreturn-8938.test.js: lifted functions against a stand-in storage; shape, marking both ways, same view,
  waits (and the projects read it asks for, at most 3), gone project, boot routing, page wiring, the full-stop nit. Mutation-checked:
  removing the readiness wait, the per-kind mark check or the full-stop trim each turns a test red.
- web.stepupreturn-8728.test.js: harness lifts the new shared pieces; review 4 list includes the invite key.
- docs/browser-checks/render-fedinvreturn-8938.js: hermetic; R1 refusal and note, R2 the return through the ask's own
  #stepup-form submit (navigation stopped, the stubbed reply carrying the real API address); three controls.

## Weakest premise
That the fresh sign-in navigates back to this same tab (sessionStorage is per tab). #8728 rests on the same premise
and was measured on production; an invite refused in one tab and signed in from another comes back to nothing,
which is the behaviour before this change.
