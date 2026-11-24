# kosmos#8959 slice B2: the plan line, and no money on the phone's account screen

## Measured (kosmos-relay coordinator/src/signin.html, origin/main, 2026-11-24 17:40 CST)
- `CAN_BUY_HERE = !IN_IOS_APP && !IN_ANDROID_APP` is the page's ONE SWITCH: "to sell inside an app later (in-app
  purchase, or a link-out if the store's rules and Josh allow one), change CAN_BUY_HERE and nothing else" (kosmos#718).
- Inside the apps the page hides billing (`#billing-buy`), Add a computer (`loadAddresses` returns at once), the cloud
  machine and the cloud waitlist (`loadCloud` returns at once).
- Inside the apps it still shows: the plan line `#plan-line` ("Kosmos+ · Active" when `/v1/account/me` says
  `kosmos_plus === true && (!standing || standing === "good")`), the address offer `#name-offer`, the Open my Kosmos
  buttons, and the computers and security sections (native since B1a to B1c).

## The call
- No link-out to Safari (the card's 03:52 plan said so; that plan was wrong, see the card). Josh's switch, not ours.
- Native plan line: `Account.planLine` mirrors the page's test word for word (strict JSON true; JavaScript-falsy
  standing). A section of its own at the top of the account screen, only when shown. Read with the other reads;
  a failed read keeps a line already shown, a 401 clears it, a sign-in change clears it.
- The "More on Kosmos+" footer names only what the in-app page still offers: the Kosmos+ address, and choosing one.
- Next slice B3: the address choice native, then the row goes.

## Tests
- ios/LogicTests/account: 20 new checks (page's cases, the request). Mutants: drop the strict-true check (fails 1),
  drop the "good" arm (fails 1).
- AccountScreenUITests.testAccountRowOpensTheNativeScreen: the footer's words, no billing/subscription/payment/cloud
  machine words on built rows, the plan line's words; shots account-sign-out and account-plan, light and dark.
- Typecheck of ios/Kosmos against the simulator SDK (0 errors; control with an injected error: 4 errors).

## Weakest premise
That the plan line is status, not selling, under #718. The in-app page already shows it, so the phone adds nothing new.
