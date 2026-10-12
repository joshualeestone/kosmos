# installidwords-5995: two comments said the install id never leaves the Mac, and it does

Card kosmos#5995, item 3 of 4. Items 1 and 2 (the site's install records) and item 4 (the computer's name at Kosmos+
sign-in) are separate branches.

## What was measured, on origin/main 60fa91f72
- `engine/phonenotify.js:14`: "never ping.installId(), which is promised never to leave the Mac."
- `engine/communitysend.js:444`: "(phonenotify promises that one never leaves the Mac)".
- `engine/createdbeacon.js:106` sends it as `installId` to Kosmos's install endpoint, on a board start and when an
  agent is made. `engine/feedbacksend.js:376` sends it as `install` with the daily report.
- `engine/ping.js`, where the id is made, already says it leaves by those two routes. Only the two comments were wrong.
- No doc, page or brief in this repo repeats the promise (query: the "never leave / stays on" phrases beside "install
  id" over `engine/*.js`, `server.js`, `docs/*.md`, `web/index.html`, `README.md`: the two comments and nothing else).

## Change
- The two comments say what happens: the id goes to Kosmos's own install and feedback endpoints and to nobody else.
- `engine/installid-senders-5995.test.js`, so the comments are a description of something held, not a new promise:
  - the engine modules whose code reads `ping.installId()` are exactly a listed five, each with what it does with it;
  - the two that send it put it in what they send;
  - the modules that talk to a coordinator or the community do not read it;
  - no engine file says it never leaves.

## Rejected
- **Only fix the comments.** A corrected comment is a claim nothing checks, which is how the wrong one stood. The test
  is what makes a new reader of the id a decision instead of a drift.
- **Stop sending the id.** Not this card: the install ping is Josh's ruling (09-14) and the card says so.

## Verify
- `node --test engine/installid-senders-5995.test.js`: 4 pass.
- Mutants, each run on 2026-10-12, each red at the named test, each restored and compared byte for byte:
  - the old promise back in `phonenotify.js`: red at "no engine file promises";
  - the old promise back in `communitysend.js`: red at "no engine file promises";
  - `phonenotify.js` reads the install id: red at the readers list, the control and the forbidden-readers test;
  - a module not on the list reads it: red at the readers list;
  - `feedbacksend.js` stops putting it in what it sends: red at "the two senders".
- NOT RUN when this was written: the full suite.

## Weakest premise
That "reads `installId()`" is the right thing to hold. A module could be handed the id by one of the five and send it
on; the list would not see that. It catches the direct read, which is how both senders got it.

## What would change this
The install id reaching a third place by being passed along. Then the thing to hold is where the two payloads go, not
who calls the function.
