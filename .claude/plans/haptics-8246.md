# haptics-8246: iPhone haptics, Josh's picks 1, 3, 4, 5 (kosmos#8246)

## Done when
On a real iPhone (TestFlight): a firm tap when an Allow or Deny answer goes, a very light tap when a message is sent,
the iPhone error pattern when a message or an answer does not go or a sign-in step is refused, and a selection click
when a swipe stars or unstars an agent. Each once per action, and nothing else new buzzes. (Not done at merged.)

## What
- ios/Kosmos/Haptics.swift (new, @MainActor): `sent()` light at 0.6, `decided()` medium, `failed()` the system error
  notification, `snapped()` selection. One place, so each action's feel is decided once.
- ChatView.send(): `sent()` past this view's guards (a press in the air, nothing to send); `failed()` when the client's
  own guard keeps a send back (the words are put back).
- ChatView: `failed()` when a message the computer refused or did not answer turns failed (Board.failedPendingIDs gains
  an id while the chat is open; a retry that fails again buzzes again; "not confirmed" stays silent). The send call
  itself returns true once it goes, so this is where a real failed send is seen. The watch and its seeding are in the
  Release build: the room suite fails if any haptic line in the five files sits inside DEBUG-only code (round 4 found
  this watch in one). Only the chat on screen (`visible`) buzzes, since the same agent can be open under two tabs; the
  set is kept with the agent it was read for (TodayView, TasksView and RoomView reuse one ChatView across agents), so a
  change of agent never counts as a new failure. A send that fails after the person has left the chat (another tab, the
  info page) does not buzz: they are not there to connect it.
- ChatView.tryAgain: `failed()` when a row's Try again is refused.
- ChatView.press(): `decided()` only when an Allow or Deny on a request's card comes back `.sent` (not on the arming
  press, not when not sure, not when nothing went); `failed()` when any press is refused.
- RoomView: `sent()` in send(); `failed()` when the room store hands a post's words back because the computer refused
  it (Returned.refused); a post not confirmed (it may have gone) stays silent, as a chat's not-sure answer does.
- AgentsView: `snapped()` only for the swipe's star or unstar (a full swipe or the revealed button); the long-press
  menu's same button stays silent.
- SignInModel counts failures (`failures`): every refusal written into the error line, the same words twice included,
  and the Mac's own no (the step becoming .denied(asking: false); .denied(asking: true) still waits on a fresh Allow);
  the person cancelling the passkey prompt is not counted. A denial writes no error line, so it never counts twice.
  Debug sample flows that set the error line buzz too (Debug only). SignInView buzzes
  on each count.

## Decisions
- Allow and Deny both get the firm tap: Josh's pick 1 is "Allow and Deny on an agent's request". It comes after the
  answer is sure to have gone, so a refused press gets only the error buzz.
- A chat message that fails gets the light tap as it is sent and the error buzz when it fails (the computer refused it,
  did not answer, or the client's own guard held it back): the card asks for both, and the tap belongs to the press. Rejected: tapping only on success (the send would feel dead for a moment).
- A refused answer and a room post handed back buzz too (pick 3, "something failing").
- Not built: pick 2 (task-done buzz), anything per incoming message, streamed line, scroll or keystroke. No Kosmos
  setting; iOS's own system-haptics switch silences all of it.

- Not buzzed, on purpose: a refusal that moves the sign-in to the web page (it carries on there); "more" options under
  Show details and an Allow/Deny drawn as a plain question (pick 1 is the card's Allow and Deny); a retry of a failed
  row taps nothing on press (it buzzes if it fails again, through the pending watch or tryAgain's refusal).

## Weakest premise
That every assignment to SignInModel.error is a failure the person should feel. Measured: every non-nil assignment in
SignInView is a refusal, an unreachable service, or the person's own input failing (a malformed email, a code that is
not six digits), except the person cancelling the passkey prompt themselves (SignIn.passkeyWords.notUsed), which is
excluded by name. A new note written into that line later would buzz too.

## Tests
- The app builds for the simulator; all ios/LogicTests suites pass (no logic changed: Haptics has no decisions to test).
- The feel is only checkable on a real iPhone (the simulator has no haptics): TestFlight, then Josh.
