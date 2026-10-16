# addcomputer-6314: adding a computer to Kosmos+, simplified screen by screen (kosmos#6314)

## Why
Josh signed a new Mac in to Kosmos+ on 2026-10-16 and hit seven snags on one path (all recorded on #6314):
the email step asked for a computer name before sign-in and the website asked again; the no-address state said
"Buy an address" with no price; after paying he had to press Check again; with one paid address he still had to
pick it; the waiting computer named the other one by an address he read as itself; after "The codes match" the big
code stayed, so nothing seemed to happen; and on the other computer he landed scrolled past the request.
His brief (11:35, 11:37): each screen does one job; push everything else down.

## Rule this follows (measured by Angel on the coordinator and live config)
An account's first computer gets the account's own address with the plan. Every further computer needs an address
bought for it, at Stripe's price for KOSMOS_STRIPE_ADDRESS_PRICE_ID ($20 a month today; a promotion code can make
it $0). The coordinator already sends that price with the address list (`price.display`, "$20/month").

## Change
- `engine/remote.js` `signinAddresses`: passes `price` (the coordinator's `price.display`) when it is an amount over
  a plain period (`PRICE_SHAPE`), else ''. Test `#6314` in `engine/remote.test.js` (proven red against main).
- `web/index.html`, Kosmos+ sign-in:
  - Email step: the name is said, not asked ("Your Kosmos+ account will list this computer as <b>name</b>. Change");
    Change opens #5995's box, kept because it is a privacy control (a person's own computer name reaches the account
    unseen without it). Text only, never markup (`plusSiComputerSay`).
  - No address waiting: heading "Add this computer to your account"; "This account has no room for this computer yet.
    Each computer you add is $20 a month." with the figure from `plusSiAddPrice(b.price)`; no
    figure: "has a fee, shown before you pay". Button "Add this computer". Hint: "Paying opens the
    Kosmos+ website. Come back to this window when you are done." The page makes no promise
    about checking; coming back fires focus, which re-reads and re-arms the 20 minutes. Pending and could-not-list
    variants reworded in the same voice.
  - Auto: while the none panel is on screen, the page re-runs Check again itself on window focus, and on a tick
    that backs off (10 s for 2 minutes, then 60 s) for 20 minutes after the panel showed or the window last gained
    focus (`plusSiBoughtAutoCheck`). Quiet: Check again is not disabled during it (a busy flag guards re-entry), so
    the focus stays where it was; a failed quiet read leaves the panel as it was. With exactly ONE free
    bought address, this computer takes it with no click (`plusSiBoughtTake`), never an address already tried in this sign-in, and not while a refusal stands (a
    person's Check again clears refusals, never tries)
    and never an address already tried (`PLUS_SI_AUTO_TRIED`); two or more always wait for a pick.
  - Card heading line-height 1.2 (it wraps on a phone now; the #6299 cause).
- `web/index.html`, the waiting computer (`paintPlusJoin`): "Allow this computer from your other one." then two
  steps naming "your other computer, <name>" and Settings > Kosmos+; after the match, "The codes match." and "Now
  press Allow on <name>, your other computer." with the code small. While waiting, `#plus-flow.plus-joining` hides
  the devices list and the company block.
- `web/index.html`, the other computer (`paintAsk`): on Kosmos+ a NEW waiting request scrolls `#plus-asks` into view
  once (`ASK.shownKey`); requests stay in that section per Josh's #4610 ruling.
- Checks: `render-plus-bought-4756.js` (single-free pick scenarios get a second address so the pick paths stay
  covered; new `paid-by-focus` scenario: price line, heading, button, focus re-read, auto-take), 
  `render-plus-computer-name-5995.js` (presses Change; asserts no box before sign-in),
  `render-connect-sheet-4637.js` (new words, small code after match, sections aside while waiting, scroll once;
  red without the fix at 390, the 1400 arm skips because the fixture page is too short to scroll),
  `mobile-shots.js` (new screens plus-add-computer and plus-join-matched).

## Decided
- No price written in the page: the figure is Stripe's, read with the list. `web.plus-tab.test.js` still forbids a
  literal price in the Plus copy, and that stays true.
- Kept the "The codes match" button label: refusal messages name it.
- Kept Check again as a fallback button beside the automatic re-read.
- Auto-taking the ONE free bought address (Josh 11:28, "it should have just pushed me through") accepts a case: an
  address bought for a different, later computer is taken by whichever new computer signs in first. The screen says
  "Connecting this computer as <address>" while it happens, and the account page can retire it. Weighed and taken.
- Rejected: a Stripe success redirect into the app (needs a URL scheme and a coordinator change).

## Known limits
- The figure is Stripe's list price (`price.display`); a promotion code applies at checkout, so a person with a code
  sees the list price here and the discount on the website.
- The tick stops 20 minutes after the panel showed or the window last gained focus; focus and Check again still work.
- Not in this change: the website pre-filling the address (kosmos-relay), and the website's post-payment lines
  (waiting for Josh's own notes).
