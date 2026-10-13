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
  That query left out `tools/` and was wrong to: `tools/test-install.sh` said the id "only leaves the Mac via the
  opt-out feedback report" (review 7). It is a third comment, and it is a pointer now.

## Change
- `engine/ping.js`, where the id is made, lists WHO sends or keeps it, one line per file, and says each file tells for
  itself when and how. Its header had the same fault as the two comments (it said the id stays on the Mac except for
  the feedback report, and left out the created beacon).
- The two comments are pointers: "this file does not send that one; engine/ping.js lists the files that do".
- Two stale lines said a notifier reuses the install id (`feedback.js`, `store.js`); the notifier has its own id.
- `engine/installid-senders-5995.test.js` holds, over every file git tracks or would track (bar tests, the
  prose under `docs/` and `.claude/`, test support and files that are not text), four exact sets:
  - the files that hold the identifier `installId`;
  - the files that hold the profile's copy, `idInstall`;
  - the files that load `engine/ping.js`, under any path and any way of loading;
  - the files that name the id's own file, `ping.json`.
  And: both senders carry this install's id in what they send (run in a sandbox, not read); in the two modules that
  talk to a coordinator and to the community every mention is a comment, bar one field named `installId` that carries
  the notifier's own id; `engine/ping.js`'s list has a line for every engine file that uses the id.

## Rejected
- **Only fix the comments.** A corrected comment is a claim nothing checks, which is how the wrong one stood. The test
  is what makes a new reader of the id a decision instead of a drift.
- **Stop sending the id.** Not this card: the install ping is Josh's ruling (09-14) and the card says so.

## Verify
- `node --test engine/installid-senders-5995.test.js`: 8 pass.
- Mutants run on 2026-10-12 after review 5, each red at the named test, each restored and compared byte for byte:
  - a tool loads `ping.js` by its `../engine/` path and reads the whole record: red at the list of files that load it;
  - `server.js` reads the id's file by name: red at the `ping.json` list;
  - `engine/ping.js`'s list drops the feedback send: red at the list test;
  - the beacon sends a fixed string: red at the senders test.
  And after review 3 (still in the test): a Swift file holding the identifier, the page reading the profile's copy,
  `phonenotify.js` reading the id in code, `feedbacksend.js` sending another value.
- NOT RUN: the full suite.

## Weakest premise
That holding the names is enough. The test does not read what a comment SAYS, so a new false sentence in a listed
file would pass; and a value handed on under another name is not seen. The largest case of that: a profile carries
`idInstall`, so anything that passes a whole profile on passes the id on unnamed. `engine/status.js` does, in every
agent's card, and no set here would see a second one do it.

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

## Review 4 (2026-10-12, sonnet)
- **WARNING, taken:** a new file not yet added to git was not scanned, so the test only went red once the file was
  tracked. The scan includes files git would track. Checked with an untracked file holding the identifier: red at the
  identifier list; the file was then removed.
- **WARNING, not taken:** the test needs a git checkout, and fails with git's own error in a tree without one. Six
  other sweeps in this repo list files the same way (`no-brand-refs-1881`, `no-name-refs-3071`, `fixture-discipline`,
  `tools.no-phone-home-4253`, `bundle.execbit-4134`, two under `engine/`) and the suite runs in a checkout. A skip
  would be worse: on this fleet a skipped guard reads as a passed one.
- **NITs, not taken:** the id's file is left in place by an uninstall, so the id outlives one (true, and not about
  where it is sent; a line for the card's delete-path item, not for this list); the shell file's entry is the one
  most likely to drift.

## Review 5 (2026-10-12, default model)
The wording check drew findings in three rounds running, in both directions, so it is gone rather than patched:
- **WARNING, taken by removing it:** it flagged true sentences ("is never sent to the community", which is what the
  corrected comments exist to say) and passed real promises worded another way. A list of phrasings cannot be both
  wide and exact. The comments were cut down to pointers so there is less for prose to get wrong, and the header says
  the test does not read what comments say.
- **WARNING, taken:** "loads `ping.js`" matched one spelling of the path. Any path and any way of loading now counts,
  with controls for eight spellings and four near-misses.
- **WARNING, taken:** nothing held a read of the id's file by name. A fourth exact set does.
- **CONVENTION, taken by saying less:** the list's lines said when each file sends (and were incomplete: a third
  trigger for the beacon, creates with no form). They now say who, and that each file says when for itself. The line
  for the profile's copy names `engine/status.js`, which serves it. The two comments say "this file does not send
  that one", not that a whole class of service never carries it.
- **NITs, taken:** titles say "files git tracks or would track"; this file's Change list has all four sets.
- **NITs, not taken:** a clearer message when there is no git checkout (the sibling sweeps have none); `docs/` is left
  out whole, runnable harness code included.

## Review 6 (2026-10-12, sonnet)
No blocker. 8 pass before and after.
- **WARNING, taken by saying it, not by a fifth set:** nothing holds what a profile reader does with the whole record,
  and that is how the id reaches the card. The test's header and Weakest premise now name it. A held set of the files
  that call `readProfile` was rejected: `server.js` alone calls it sixteen times, so the set would be one long entry
  that never changes when a new serializer is added inside a listed file. The guard that fits is on the served card
  itself (no `idInstall` in it), and it belongs with the change that strips the id from the card (the fifth finding
  on the card, its own branch).
- **WARNING, taken:** the scan left out `docs/` and `.claude/` whole, runnable browser checks included (review 5 left
  this as a NIT). Only the prose there (`.md`) is left out now. Two more files hold `idInstall` and are listed: a
  captured card fixture with the id blanked, and a comment in the check that reads it. Proven: a file planted under
  `docs/browser-checks/` that loads `engine/ping.js` and posts the id turned two tests red by name (the identifier
  set and the loader set, 6 pass 2 fail); the same words planted in a `.md` under `docs/` left all 8 green.
- **CONVENTION, not taken:** count only files already added to git, and warn on the rest. Review 4 asked for the
  opposite and it was taken then: a new sender is untracked until someone adds it, and the suite is run before that.
  A scratch file that reddens one checkout says so in the failure message. Two rounds, two directions: the rule is
  that the scan reads what git would track, and it stays.
- **NIT, not taken:** a word boundary before `installId`. Without it a longer word is over-counted and the exact set
  fails loudly; with it `_installId` would be missed quietly. The loud direction is the one to keep.
- **NIT, taken:** the descriptions beside each listed file are for the reader and nothing checks them; the test says so.
- **NIT, not taken:** no timestamp in this file's name (weighed in review 3).

## Review 7 (2026-10-12, default model)
No blocker. 8 pass before and after.
- **WARNING, taken:** a third comment made the same false promise, in `tools/test-install.sh`, a file the test already
  listed by name without anyone reading its sentence. Reduced to a pointer like the other two. The first search for
  the promise had not looked under `tools/`; the reviewer's wider search (every file bar tests, plans and prose) found
  this one and no other.
- **WARNING, taken:** the loader set saw only a literal path inside `require`, `from` or `import(`, and loading an
  engine module through `path.join` is common outside `engine/`. It now holds any quoted word that is `ping` or
  `ping.js`, alone or ending a path. That brings in two files that use the word for something else (a comment in
  `engine/guidestate.js`, a message type in `engine/win32channel.js`); both are listed with what the word is there.
  Proven: the reviewer's plant (a tool that loads it through `path.join` and posts the whole record) turned that test
  red by name, 7 pass 1 fail. A name built from pieces of the word is still not seen, and the comment says so.
- **NIT, taken:** "one machine's reports" in `engine/feedback.js` is "one install's".
- **NIT, taken in part:** the rule stays that the scan reads what git would track (reviews 4 and 6). The data folders
  a test board makes at the top of the repo (`.aw-*`) are left out, so a board that mints an id there while the suite
  runs cannot redden this test. Checked: a `ping.json` planted in such a folder left all 8 green.
- **NIT, taken by saying less:** the run time is gone from Verify.

## Review 8 (2026-10-12, sonnet): converged
No blocker, no warning, no convention finding. 8 pass.
- **NIT, taken:** the recorded card's id is replaced by a fixed zero uuid, not blanked; the description says so.
- **NIT, not taken:** the parser of `engine/ping.js`'s list would read a rewrapped continuation line that starts with
  a file path as a new entry. It fails loudly, with the two lists printed.
- **NIT, noted:** no proof file yet. It is written after the full validation, last.

