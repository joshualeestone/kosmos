# switchk-6585: computer switcher, instant both ways

Card: kosmos#6585. Josh 2026-10-19 09:12 ("it immediately switches ... our animated K with the dots, that's fine") and 09:25 ("when I tried to flip back to mine, I got the blue login screen again").

## Finished looks like
- Choosing another computer in the switcher shows the animated K and that computer's name from the click until its page replaces this one.
- A computer measured as unable to take the instant switch (an older Kosmos there) is not opened: a toast says why and what to do.
- In the Mac app, on another computer's page, choosing THIS computer goes back to this computer's own board (as View > Back to This Computer), never to a sign-in at its Kosmos+ address.

## Causes (measured 2026-10-19)
1. tmnt ran 0.7.55, whose gate predates #6406's ticket: sign-in page. Fixed operationally (tmnt updated to 0.7.59).
2. tmnt's pairing record of the laptop had no account (paired 10-16, before #443 kept accounts): ticket refused. Fixed by hand for this pair; the class is #6592.
3. Switching back: the remote page asks tmnt's board for a ticket, refused by design (ticketCallerHere: only this computer's own screen), so the laptop's public address opens and asks for a sign-in.

## Changes
- engine/account-computers.js: probeReach replaces probeOnline in fetchComputers. One HEAD of /_kosmos/ticket: any answer is online (as before), 405 also means it takes tickets; an older gate answers its sign-in page (200). Rows carry `instant` only when online and measured.
- web/index.html: rows carry data-computer-name and data-computer-instant="0"; the phone menu copies both. computersOpenClick refuses "0" with a toast; otherwise computersSwitchingScreen (opaque, role=status, startKLoader canvas, "Opening <name>"); pageshow removes it (back from the bfcache).
- native-app/main.swift: switchGoesHome (pure, 11 selftest rows, expected 181 -> 192), asked in the main-frame navigation policy before the link rules; a click to the own Kosmos+ address while on another computer cancels and calls backToThisComputer.

## Rejected
- Passing the app's local board origin in the fragment to the other computer's page: page-supplied navigation targets, and both computers must update. The native intercept needs neither.
- Letting a remote page mint tickets: the ticketCallerHere guard is the security boundary (a remote viewer must not hop onward).
- A relay change to advertise ticket support in a header: the 405 on the existing path already says it, with no relay release.

## Weakest premise
That every gate older than #443 answers HEAD /_kosmos/ticket with 200. Measured on tmnt at 0.7.55 (GET 200 sign-in page) and in source (the gate serves its page for any path to a stranger); not measured on a still-older gate.

## Verification
- engine/account-computers.test.js 11/11 (perturbed: probe '/' turns 1 red).
- web.computers-switcher-4648.test.js 17/17 (perturbed: refusal removed turns 1 red).
- --kosmos-app-mode-selftest 192/192 (perturbed: switchGoesHome false turns 2 red); native-app wiring tests 66/66.
- Full web.* suite; browser-check gates; design shots of the switching screen and the toast.
