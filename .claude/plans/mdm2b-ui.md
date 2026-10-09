# mdm2b-ui: Sign in with your company, in the Kosmos+ wizard (kosmos#5628 slice 2b-ui, with kosmos#5651's board half)

On a computer whose company's MDM installed the Kosmos profile, the "Sign in to activate Kosmos+" wizard offers
"Sign in with your company". Built on slice 2b's engine and routes (kosmos#5638, merged) and the coordinator's slices
1, 2a, 2c and kosmos#5651 (served).

## Done looks like
- The button shows only when the profile is installed (GET /api/remote/managed).
- Start: the engine opens the company's sign-in in the browser (POST /api/remote/company/open, the address the engine
  checked; the Mac app blocks a page's late window.open) and the page shows the code to compare.
- The page asks at the setup's interval until the person approves, then asks for this computer's name and finishes.
- No terms step here: a new person agrees on the approval page (slice 2c).
- An account with a second step: the board asks once for its text (kosmos#5651, POST /api/remote/company/second-text);
  a text-message account is texted, an authenticator account is asked for the app's code; "Text me again" for a text
  that did not come, held for the coordinator's wait.
- Start over, Sign out, a new start and late answers never leave a stale step or overlapping requests.

## Decisions
- Only the opener's exit 0 is "opened"; a missing or refusing opener says use the link.
- The coordinator's takeover sentence (a name held by another computer) is said in its own words, on every text.
- "Email me a code" is never offered as a way out (a company that requires its own sign-in refuses it).
- Texts and finishes never overlap (page sequence numbers, and the engine refuses either beside the other).
- Weakest premise: the page matches some coordinator sentences by words (second step, start again, metered answers);
  a wording change there degrades to the generic message, never to a wrong action.
