# reviewkey-7357: a review sign-in drops a device key kept by an earlier code sign-in

Card: kosmos#7357 (Ice Cream Kitty's question, Fleet Builders m733).

## Finished looks like

After a password sign-in through the App Store review door, the phone holds no device key from an earlier code
sign-in, so nothing it later proves at a computer's gate (#7337) names a key the review session is not for.

## Why

The review door makes the session's device itself (review-<hex>) and never uses the phone's. On main nothing sent
after sign-in carries the phone's own id (push register, unregister, sign-out and the Allow watch all read the
device from the session token), so today there is no mismatch. #7337, once merged, proves the KEPT key at a
computer's gate; on a phone that once signed in with a code and then used the review door, that would prove an
older key under a review-* session. A key can survive deleting and reinstalling the app (the keychain keeps it), so
a review phone that ever ran the app with a code sign-in can hold one.

## Decided

- Drop the kept key when a review sign-in is admitted (SignIn.reviewDropsKey). A later code sign-in on that phone
  makes a new key, which the Mac allows once. Rejected: tracking which session a key belongs to; heavier for a case
  only App Review's own device can reach.

## Verify

LogicTests (with a control: nothing dropped when nobody was signed in), iOS 16 simulator typecheck.

## Review bound

Challenge loop to convergence. Merge on green.

## Review 1
- The rule takes the ReviewAnswer the password step switches on, and is called there before the switch; tested on
  the server's own answers with controls (wrong password, closed door, unreadable answer). A second step or setup
  answer would drop the key too, should the door ever ask for one.
- The old code-sign-in device stays on the Mac's allowed list, never proved again; harmless (no lock-out).
