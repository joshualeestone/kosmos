# iosfresh-4903: the iPhone opens a Kosmos cloud machine (kosmos#4903, kosmos#7337)

Owner: Angel. Splinter, 07:58 and 08:15 CDT 10-27: build both halves on one branch, merge after the UNHOLD, and not
the freshness half alone.

## Finished looks like
The iPhone app opens a Kosmos cloud machine from the switcher with no Allow anywhere, and a Mac behaves as before.

## Why it could not
A hosted box's gate (relay crates/tunnel/src/proxy.rs `pending_answer`) refuses, in order: a sign-in that proves no
device key (403 NO_KEY), then one older than ten minutes (hosted::FRESH_SECS). The app proved no key and asked for no
fresh handoff.

## What changes
1. Freshness: `hosted` is read from /v1/account/macs (Ice Cream Kitty adds it on S3, cloudwait-4903); a hosted computer
   is asked with `{"fresh": true}`; Kosmos+'s `step_up_required` shows "Sign in again to open <name>" with the remedy
   the app already names (log out under Settings, Kosmos+, and sign in again).
2. The key (#7337): before each session request, GET /_kosmos/nonce, sign gateproof::message (kosmos-gate-v2, host,
   nonce, base64url(SHA-256(token)), k1. id) with the key #7042's native sign-in kept, and post {token, nonce, key, sig}.
   409 retry (a spent nonce, or a hosted box that has just allowed the key) signs again with a new nonce, five times
   in a row at most, then waits as a slow answer.
3. The board only ever uses a key the sign-in KEPT (`SignInClient.keptDeviceKey`), never a new one: a phone signed in
   on the web page has none, and sends the token alone as before. So does a gate with no nonce route (404).

## Verification
- Logic tests (1446 after review 4): the proof verifies over the gate's message and not over another host's; 409 then a new nonce
  then admitted; no key = no nonce asked, token alone; 404 nonce = token alone; hosted = fresh handoff; step-up =
  signInAgain; Mac controls. Controls: main's BoardClient fails the hosted checks; swapping two message fields fails the
  signature check.
- The app target builds (iphoneos27.0), which compiles AgentsView, SignInClient and BoardClient+App.
- Still owed: a real cloud box (after S3, S4 and #7281 reach production) and a real Mac in gate-v2 enforcing mode.

## Weakest premise
That sending a key proof to a MAC changes nothing a person sees there. A Mac with the v2 marker answers a keyed knock
with its keyed code (the code the phone already shows for Allow); an already-allowed phone should stay admitted. Not
measured on a real Mac.

## Review 3 (Angel, 10-27 afternoon, after the rebase onto main)
- A session 429, and a 403 with paused or keep, are their own answer (`held`): the computer is not taking new sign-ins
  now, nothing is wrong with this one. As gate.html: stop, show the gate's own `because`, keep the token, no fresh
  handoffs. Before, they were refusals retried with new handoffs until "did not accept this iPhone's sign-in".
- The nonce and session requests send a User-Agent holding "iPhone", so the Mac's Allow card names the device
  (relay gatev2.rs ua_class); the system's own User-Agent read as "another browser".
- A busy gate (503 retry) is a miss for every phone, with a key or without, as gate.html's missOne; before this
  branch a key-less phone treated it as a refusal and asked for fresh handoffs. Deliberate: it matches the gate page,
  and a busy computer is not a verdict on the sign-in.
- No Sign in button on "Sign in again to open <name>": the board's openBoard keeps the same, not recent, sign-in, so a
  button there would not do what it says. A one-tap way needs a log out wired into the Agents screen (follow-up).
- Review 4: a cloud machine refusing a key-less phone says sign in again at once (no fresh handoff cures a missing
  key); a Mac's refusal keeps its retries. A 400 on the nonce route is a miss, as gate.html.
- Review 5 (after the final run): every LogicTests script that compiles BoardLogic.swift now compiles SignInLogic.swift
  too (five sub-suites no longer built). A cloud machine's no-key refusal has its own screen, "Sign in on this iPhone",
  not "recent": only a sign-in in the app keeps a key; the web page never does.
