# haptics-8246: iPhone haptics, Josh's picks 1, 3, 4, 5 (kosmos#8246)

## Done when
On a real iPhone (TestFlight): a firm tap when an Allow or Deny answer goes, a very light tap when a message is sent,
the iPhone error pattern when a message or an answer does not go or a sign-in step is refused, and a selection click
when a swipe stars or unstars an agent. Each once per action, and nothing else new buzzes. (Not done at merged.)

## What
- ios/Kosmos/Haptics.swift (new, @MainActor): `sent()` light at 0.6, `decided()` medium, `failed()` the system error
  notification, `snapped()` selection. One place, so each action's feel is decided once.
- ChatView.send(): `sent()` after every guard (a press in the air or a refused send taps nothing); `failed()` in the
  not-sent branch, where the words are put back.
- ChatView.press(): `decided()` only when an Allow or Deny on a request's card comes back `.sent` (not on the arming
  press, not when not sure, not when nothing went); `failed()` when any press is refused.
- RoomView: `sent()` in send(); `failed()` when the room store hands a post's words back because the computer refused
  it (Returned.refused); a post not confirmed (it may have gone) stays silent, as a chat's not-sure answer does.
- AgentsView: `snapped()` only for the swipe's star or unstar (a full swipe or the revealed button); the long-press
  menu's same button stays silent.
- SignInModel counts failures (`failures`): every refusal written into the error line, the same words twice included,
  and the Mac saying no (the step becoming denied, once: the watch re-setting the same denial is not counted again);
  the person cancelling the passkey prompt is not counted. A denial writes no error line, so it never counts twice.
  Debug sample flows that set the error line buzz too (Debug only). SignInView buzzes
  on each count.

## Decisions
- Allow and Deny both get the firm tap: Josh's pick 1 is "Allow and Deny on an agent's request". It comes after the
  answer is sure to have gone, so a refused press gets only the error buzz.
- A chat message that fails gets the light tap as it is sent and the error buzz when it comes back: the card asks for
  both, and the tap belongs to the press. Rejected: tapping only on success (the send would feel dead for a moment).
- A refused answer and a room post handed back buzz too (pick 3, "something failing").
- Not built: pick 2 (task-done buzz), anything per incoming message, streamed line, scroll or keystroke. No Kosmos
  setting; iOS's own system-haptics switch silences all of it.

## Weakest premise
That every assignment to SignInModel.error is a failure the person should feel. Measured: every non-nil assignment in
SignInView is a refusal, an unreachable service, or the person's own input failing (a malformed email, a code that is
not six digits), except the person cancelling the passkey prompt themselves (SignIn.passkeyWords.notUsed), which is
excluded by name. A new note written into that line later would buzz too.

## Tests
- The app builds for the simulator; all ios/LogicTests suites pass (no logic changed: Haptics has no decisions to test).
- The feel is only checkable on a real iPhone (the simulator has no haptics): TestFlight, then Josh.
