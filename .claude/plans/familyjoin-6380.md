# familyjoin-6380: the join button names a family too (kosmos#6380, Kids #6239)

## What
- web/index.html: the button reads "Join Company or Family Account" (icon and outline kept); the entry panel says
  "Enter the code your company or family gave you to connect this Kosmos."; the field's placeholder is "Join code" and
  its label "Your company's or family's join code". Connect Account and X Cancel unchanged.
- Tests and checks that pin the words: web.joincorp-5791.test.js, docs/browser-checks/render-orgenroll-5531.js, the
  browser-checks README row and the mobile-shots note.
- Console side (kosmos-relay branch familyjoin-6380): instructions name the new label, then the older ones.

## Decided (on the card, Josh can override)
- One label for both kinds: the button is pressed before the code is checked, so the kind is not known yet.
- Rejected: keeping "Join Corporate Account" (wrong for every family); a label per kind (nothing tells the board the
  kind before a code); "Join a family or company" (rewrites more of Josh's 10-10 copy than needed).

- The building icon stays (aria-hidden, decorative): changing a picture Josh chose with the button on 10-10 is a design
  call, left to Mona Lisa's review rather than made in a wording card (challenge iterations 1 and 3).

## Weakest premise
That adding "or Family" costs a company person nothing; Josh picked the old words for companies on 10-10.

## Verify
- web.joincorp-5791 and web.familywords-6239 pass.
- render-orgenroll-5531.js passes headless (pw-runtime) and FAILS against main's page (control).
