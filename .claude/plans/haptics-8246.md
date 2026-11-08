# haptics-8246: iPhone haptics, Josh's picks 1, 3, 4, 5 (kosmos#8246)

## Done when
On a real iPhone (TestFlight): a firm tap when an Allow or Deny answer goes, a very light tap when a message is sent,
the iPhone error pattern when a message or an answer does not go or a sign-in step is refused, and a selection click
when a swipe stars or unstars an agent. Each once per action, and nothing else new buzzes. (Not done at merged.)

## What
- ios/Kosmos/Haptics.swift (new): `sent()` light at 0.6, `decided()` medium, `failed()` the system error notification,
  `snapped()` selection. One place, so each action's feel is decided once.
- ChatView.send(): `sent()` after every guard (a press in the air or a refused send taps nothing); `failed()` in the
  not-sent branch, where the words are put back.
- ChatView.press(): `decided()` in the `.send` step only, for the request card's Allow and Deny (the arming press of a
  lasting choice taps nothing; plain question options tap nothing); `failed()` when a press is refused.
- RoomView.send(): `sent()`, as a chat's send.
- AgentsView star swipe: `snapped()` in the swipe action, star or unstar.
- SignInView: `failed()` whenever a refusal sets the error line.

## Decisions
- Allow and Deny both get the firm tap: Josh's pick 1 is "Allow and Deny on an agent's request".
- A refused answer gets the error buzz (pick 3, "something failing"); a refused message too.
- A room post that fails is not buzzed: RoomStore.post returns nothing to tell a failure by. Rejected: changing its
  return for this card.
- Not built: pick 2 (task-done buzz), anything per incoming message, streamed line, scroll or keystroke. No Kosmos
  setting; iOS's own system-haptics switch silences all of it.

## Weakest premise
That `SignInModel.error` is set only for a failure a person should feel. Measured: every non-nil assignment in
SignInView is a refusal, an unreachable service, or the person's own input failing (a malformed email, a code that is
not six digits), except one: the person cancelling the passkey prompt themselves (SignIn.passkeyWords.notUsed), which
is excluded by name. A new note written into that line later would buzz too.

## Tests
- The app builds for the simulator; all ios/LogicTests suites pass (no logic changed: Haptics has no decisions to test).
- The feel is only checkable on a real iPhone (the simulator has no haptics): TestFlight, then Josh.
