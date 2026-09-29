# museui-4569: the Meta row reads green after a sign-in, and Meta's sign-in shows it is working and that it finished

Card: joshualeestone/kosmos#4569 (claimed:angel), Josh's 10:47 and 10:48 comments. The reply fix is PR #4572.

## Finished looks like
- Settings > AI Models, Meta row: green "Signed in · confirmed <when>" once Kosmos has seen the sign-in work (its
  own sign-in, or a Muse turn that finished); amber "Signed in" when only Muse Code's own record says so; red
  "Not connected" with Sign in again when Meta refused the last turn (it used to vanish). Never the black pill.
- Add a provider > Meta: from the click, the button stays in place (off) with a spinner and "Connecting..." beside
  it. Signed in: the button is REPLACED by "✓ Signed in to Meta Muse. You can close this window." and Close is
  the primary action, with focus. Failed or ended: the reason, and the button reads "Try again".
- The provider menus say "Meta Muse", not "Meta / Llama".

## Decisions
- Green from Kosmos's own sign-in: it is Meta accepting the sign-in, the same kind of evidence as the ChatGPT
  handshake that turns OpenAI green. Slice 3c-2 had kept it muted on purpose; Josh's 10:47 message overrules that,
  and the server test is updated to his ruling.
- Amber, not green, when only Muse Code's own file says signed in: Kosmos has not seen it work (the #1921 rule
  every other row follows).
- No Check now: the only way to check Muse is a real turn on the person's Meta account. Josh asked for it "if the
  Muse status can be checked"; it cannot be checked for free, so the row says a turn or signing in again updates it.
- A refused sign-in is a red row with Sign in again, not no row: a vanished row reads as "never set up".
- The first-run screen's "Llama / Meta" row is left: it names models (Claude, GPT, Gemini, Llama), and the card
  names only the dropdown.
- The spinner is added to the first-run Meta sign-in too (same controller); its success stays the row turning
  Connected (that place has no window to close).

## Weakest premise
That Kosmos's own sign-in finishing means Meta accepted the credential. It is recorded when `muse login` completes
(engine/musesignin.js); a sign-in Muse finished but Meta later refuses turns the row red on the first refused turn.

## Tests
- engine/musestatus.test.js: lastSeenWorking (never from Muse's file alone; Josh's case, file + Kosmos sign-in, is
  seen working; the newer of turn and sign) and refused.
- server.runners.test.js: /api/accounts badge working after Kosmos's sign-in, rejected after a refusal, working again.
- docs/browser-checks/render-muse-signin-3939.js: the spinner beside the off button, the success line replacing the
  button with Close primary and focused, Try again after a failure, Stop resets the label; green / amber / red rows.
