# #4638: a second computer on a Kosmos+ account skips the address chooser

Card: joshualeestone/kosmos#4638 (Josh 15:13-15:17; Splinter's call). Owner: PigeonPete.

## What the coordinator already sends (measured, kosmos-relay origin/main)
The sign-in answer (coordinator/src/signin.rs SigninVerifyResp) carries `account_address` (absent once another live computer of the account holds its name, #3823), `addresses` (the account's addresses), and `match_code` (the same XX-XX code the other computer's Allow card shows, proto matchcode.rs). The app kept only the token and account_address.

## Change
- engine/remote.js absorbSession -> secondComputerFields: when there is no owned address and the account lists an address, pass `other_address`, `match_code` (checked against the coordinator's alphabet, XX-XX) and `computer` (this computer's own name, the one its Allow card shows, without " (Kosmos app)"). Anything off-shape is absent.
- web/index.html: plusSiStage('session') with other_address and no account_address: no chooser. The name is the computer name made valid (plusNameClean; the private suggestion when nothing usable is left), registered through the existing automatic-register path; a "name is taken" / "already in use" refusal tries name-2 ... name-9. The landing (plus-si-done) says "<Computer> is connected to Kosmos+ as <address>." and shows the code, large, with "your other computer (<name>) is asking whether to let this one in. Allow it there if it shows this code". plusSiClear resets it.
- First computer (no other address): unchanged.

## Decided (reversible), and not done here
- The card asks to "move on automatically when the laptop allows it". The app cannot see that today: the only route that reports it is GET /v1/account/me (device_status), and the tunnel has no subcommand for it and its guard refuses the route. That needs a kosmos-relay tunnel change and release: filed as a follow-up. Until then the code sits on the done landing with Done, and registering does not wait for the approval (the coordinator does not require it).
- Order differs from the card (register, then show the code) because register does not need the approval and the approval cannot be observed yet; both land on one screen.
- Weakest premise: `addresses` non-empty with no account_address means "another computer holds the name". A reinstalled computer whose old record is still live reads the same way and gets the automatic name instead of the chooser (the chooser also offered only a new name there).
- Look: Mona's #4637 redesign covers the visual design; this uses the wizard's existing styles plus a large code line.

## Tests
- engine/remote.test.js #4638: second computer fields; hostile shapes absent; a code outside the alphabet dropped; an owned address and a brand-new account are not second computers. 4 mutants each fail.
- docs/browser-checks/render-plus-second-computer-4638.js (gated, 8): no chooser; pizzarama then pizzarama-2; landing line, other computer named, code large; controls. Fails on main's page and without the clash retry.
- Regression: render-plus-signin-3478 all passed; engine/remote.test.js 114/114.
