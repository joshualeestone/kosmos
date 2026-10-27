# pwsignin-7357: the iPhone half of the App Store review door

Card: kosmos#7357. The coordinator half is Ice Cream Kitty's (kosmos-relay reviewdoor-7357, POST /v1/signin/review,
converged, waiting for the relay push window). This is the phone's side.

## Finished looks like

While Kosmos+ has the review door open (a review window), the iPhone's email step offers "Sign in with a password".
The review account signs in with its email and password and lands on the usual "Allow this iPhone on your Mac" step,
then in the app once the review computer allows it. Outside a review window (the door closed, which is every other
day) nobody sees anything new.

## Steps

1. SignInLogic: reviewPath, reviewBody (email, password, device_name only; the server makes its own review device id),
   reviewDoorOpen(status:) (405 open, 404 closed, anything else no answer), and a `password` step.
2. SignInClient: reviewDoorOpen() (a GET) and reviewSignIn(email:password:), answered by SignIn.answer like verify.
3. SignInModel: asks about the door when the email step shows, like passkeys; asked again after a sign-out; sample
   screens never ask. passwordSignIn ends in take(), so the Allow watch and session hand-over are verify's own.
4. SignInView: the link on the email step, and the password step (email, password, Sign in, Sign in with a code).
5. LogicTests: the door rule with a control, the body, an admitted answer, a refusal.

## Decided

- The phone shows the link only on a clear 405. Any other answer (a 200, a 429, no answer) hides it and asks again
  next time, so a misconfigured server never offers a password sign-in.
- The device id in the answer is ignored: after sign-in the phone uses only the session token.
- Weakest premise: that the review door's GET keeps answering 405 while open (review.rs answers before reading the
  method only when closed). If the coordinator changes that, the link silently never shows; the logic test pins the
  phone's side only.

## Verify

LogicTests run.sh, iOS 16 simulator typecheck, server.ios-routes-6838.test.js. The real walk needs Kitty's door
deployed with a review window; until then the sample screens (KOSMOS_SAMPLE_SIGNIN=review, password) show it.

## Review bound

Challenge loop to convergence. Merge on green (beta rule); it does nothing until the door is configured.
