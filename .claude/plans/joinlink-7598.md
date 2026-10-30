# joinlink-7598: the board's "Create an account" opens the account-only sign-up (kosmos#7598, board half)

## What finished looks like

- A company member with no account, stuck on the board's code step, is offered the account-only sign-up on the
  coordinator this board signs in to, not the pricing page, and is told to stop before paying.
- The coordinator's same answer for every address (#2664) is unchanged; the line is the same for every address.
- (Card-level, needs Baron's signup half and a served build: a fresh member gets from no account to joined without
  paying. Measured after both are live.)

## What was built

- `server.js`: GET /api/remote gains `signupUrl`, `remote.coordinator()` without trailing slashes plus `/signup`.
- `web/index.html`: paintPlus keeps it as `PLUS_SIGNUP_URL` through `plusSignupUrl` (a plain https address with no
  sign-in part and nothing a link should not carry in the host, or ''); the #6313 late line links it, then says
  "Joining your company? Stop before paying: your company's plan already covers you." With no address, no link and no
  company sentence, as before.
- Tests: `server.signup-link-7598.test.js` (default and a test coordinator, with a control that the env reaches the
  read), `web.signup-link-7598.test.js` (the address check; the late line run under a fake document, with and without
  an address; the store goes through the check), and `docs/browser-checks/render-plus-signin-3478.js` (the link equals
  the stubbed signupUrl, not the pricing link, and the whole line to its end; measured green on this page and red on
  main's).

## Decisions

- No host constant in the page (Baron's card said one): the engine already knows the coordinator, and a constant
  would send a board on a test coordinator to the production sign-up.
- An http coordinator (a developer's) gets no link, on purpose.
- A coordinator set with a path or query builds a broken /signup, as /v1/meta's own address does; kept consistent.
- The reason given is the true one (the company's seats cover members). The first draft said the join would refuse
  them; that was false and was removed before anything was pushed.

## Weakest premise

- A stuck member waits the 60 s for the late line. If people leave sooner, the next step is a static line on the code
  step from the start.
