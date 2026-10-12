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
- `engine/ping.js`, where the id is made, now lists where it goes, one line per file. Its header had the same fault
  as the two comments, in other words: it said the id stays on the Mac except for the feedback report, and that the
  profile's copy never leaves; it left out the created beacon, and the profile is served to the board's own pages.
- The two comments point at that list and say only that a coordinator, and the community, are not on it.
- Two stale lines said a notifier reuses the install id (`feedback.js`, `store.js`); the notifier has its own id.
- `engine/installid-senders-5995.test.js` holds the list to the source:
  - the shipped files that MENTION the install id by name are exactly a listed eight (in code or a comment);
  - the same for the profile's copy, `idInstall`;
  - the created beacon's payload carries this install's id; the feedback send puts it in its payload;
  - in the two modules that talk to a coordinator and to the community, every mention is a comment, bar one field
    that is named `installId` and carries the notifier's own id;
  - the wordings found so far for "it never leaves" are in no shipped file, with controls;
  - `engine/ping.js`'s list names every engine file that uses the id.

## Rejected
- **Only fix the comments.** A corrected comment is a claim nothing checks, which is how the wrong one stood. The test
  is what makes a new reader of the id a decision instead of a drift.
- **Stop sending the id.** Not this card: the install ping is Josh's ruling (09-14) and the card says so.

## Verify
- `node --test engine/installid-senders-5995.test.js`: 9 pass, about a fifth of a second.
- Mutants, each run on 2026-10-12 after review 3, each red at the named test, each restored and compared byte for byte:
  - the old promise back in a `phonenotify.js` comment: red at the wording test;
  - a Swift file starts holding the identifier: red at the identifier list;
  - the beacon sends a fixed string: red at the senders test;
  - `feedbacksend.js` sends another value under the same local name: red at the senders test;
  - `phonenotify.js` reads the id in code: red at the comment-only test and at the list of files that load `ping.js`;
  - `engine/ping.js`'s list drops the beacon: red at the list test;
  - the page reads the profile's copy: red at the `idInstall` list;
  - `server.js` loads `ping.js` without naming the id: red at the list of files that load it.
- NOT RUN: the full suite.

## Weakest premise
That a mention by name is the right thing to hold. A value handed on by one of the listed files, under another name,
is not seen. And the "never leaves" wordings are a list, so a new wording passes until someone adds it.

## What would change this
The install id reaching a third place by being passed along. Then the thing to hold is where the two payloads go, not
who calls the function.

## Found while fixing this, and NOT fixed here
The profile's copy of the install id (`idInstall`) is in every agent's card: `engine/status.js` serves the whole
profile, so `/api/status` hands it to the board's pages, and over Kosmos+ that answer travels to the person's phone
through the relay. The page does not use it. Taking it out of the served card is a behaviour change with recorded
fixtures behind it (`tools/capture-agent-card.js` blanks it; a browser check counts the profiles that carry it), so it
is its own branch. Written on the card.

## Review 1 (2026-10-12, default model)
- **WARNING, taken by saying less:** "and to nobody else" was false: the profile's copy is served to the page. The
  comments no longer say where the id does not go beyond "not to a coordinator / the community", which a test holds.
- **WARNING, taken:** the test looked for a call, `installId(`, which a property read, a destructure or the profile's
  copy all slip past. It now holds every mention of the name, and of `idInstall`, with no comment stripping.
- **WARNING, taken:** the scan was `engine/` only. It reads the server, the page, the installers and the tools too.
- **WARNING, taken by removing it:** the comment stripper could hide a real read behind a string holding `/*`.
- **WARNING, taken:** the beacon assertion passed on any non-empty string. It compares to this install's id.
- **WARNING, taken as far as a list goes:** the "never leaves" pattern missed five other wordings. They are in, with
  controls both ways; the test's name says it is the wordings found so far.
- **CONVENTION, taken:** the header claimed the test holds which endpoints; it does not, and no longer says so. The
  test sandboxes its data root before it reads the id. `engine/ping.js` is no longer exempt, and its header is fixed.
- **NITs, taken:** the two stale notifier lines; controls on the untouched sentences.

## Review 2 (2026-10-12, sonnet)
- **WARNING, taken:** `engine/ping.js`'s first sentence still named one route out (the feedback report) above a list
  that names two. It points at the list.
- **WARNING, taken by saying exactly what is held:** the test matches the identifier `installId`, not every spelling
  of "install id". Widening it to prose was measured: five more files say "install id" in two words, about test boards
  and an old bug, and none reads the id; holding those would make any comment that uses the phrase a red. The test's
  header says "the exact identifier" and lists what that leaves out.
- **WARNING, a known limit, now written in the test's header:** a "never leaves" wording in a list with no full stop
  and no mention of the id beside it.
- **WARNING, taken:** the list's line for the profile's copy says the pages it is served to include a phone over
  Kosmos+.
- **NITs, taken:** two more true sentences as controls, one of them through the "It ..." follow-on branch.

## Review 3 (2026-10-12, default model)
- **WARNING, taken:** the scan walked chosen folders and missed the native app, the deploy scripts, files with no
  extension and the git hooks. It asks git for every tracked file now, so no folder can be left out.
- **WARNING, taken:** the wording check matched "install identity" and "uninstall idle", so a true sentence about
  another thing would have gone red. It needs the id as a word of its own, reads only comment text (code joined into
  one long "sentence" was a false red I hit while fixing this), and looks only in the files that hold the identifier.
- **WARNING, taken as far as a list goes:** six more ways of saying "it never leaves" are on the list, with controls.
- **WARNING, taken:** the feedback half matched source text. It writes a report in the sandbox and compares what the
  send would carry, and what the report file holds, to this install's id.
- **CONVENTION, taken:** "one per install" is one per Kosmos data root (a computer can run several); `ping.js`'s list
  has a line for the id's own file, and says the board-start send has no off switch where the feedback one does.
- **CONVENTION, not taken:** a timestamp in this file's name. The plans beside it on main carry none, and the gate
  finds a plan by the branch name.
- **NITs, taken:** a comment that opens on the same line counts as a comment; a loop that could not fail on its own
  is gone; the list test reads an explicit flag, not the wording of a description; the files that load `ping.js` are
  held too (the gap "reads the id's file without the identifier", as far as loading the module goes).
