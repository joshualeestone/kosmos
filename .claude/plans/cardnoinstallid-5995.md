# cardnoinstallid-5995: the install's id rode out in every whole profile

Addresses #5995 (the fifth finding, comment 6132409431). Found while fixing item 3; its own branch on purpose.

## What was measured, on origin/main a8e120532
- A profile keeps a copy of the install's id (`idInstall`, written by `engine/store.js` beside the agent's own `id`).
- Whole profiles are served. Three places, found one review at a time, which is why the fix moved (see Reviews):
  `engine/status.js` puts the profile in each agent's card (an agent with a pane, and one without); `server.js` puts it
  in a stopped agent's row; and the answer to a profile save spreads the saved record. All three go to the page, and
  the status answer goes through Kosmos+ to a phone.
- Nothing outside `engine/store.js` reads the copy: a fixed-string search for `.idInstall` over the whole tree, bar
  plans, finds it only in that file and in tests (the same search finds 4 lines in `engine/store.js`, the control).
  The name alone also appears in a comment in `engine/agentfile.js`, in `tools/capture-agent-card.js`, in two comments in
  `docs/browser-checks/render-talk.js` and in the recorded card fixture. (`server.js` holds the letters only inside
  another word, `midInstall`.) The relay, the community service and the site do not hold it at all.

## Change
- `engine/store.js`: **a profile leaves that file without the install's id.** `readProfile` and the answer of
  `writeProfile` are copies without `idInstall`. The record as it is on disk is read by a function that is not
  exported, for the two readers that need the copy: the stamp in `writeProfile` (is this agent this install's, or does
  it need a fresh id) and `agentId`.
- `engine/status.js` and `server.js` are unchanged from main: no place that serves a profile has to remember anything.
- The recorded card (`docs/browser-checks/fixtures/agent-card.json`) loses the key, because a recording mirrors what a
  card serves; its test asserts the key is absent. The capture tool still replaces one with a fixed value, for a card
  captured from a board that predates this.
- Tests. `engine/status.cardnoinstallid-5995.test.js`: both doors of the store, both kinds of card on the real
  snapshot, each with a control that the profile arrived and that the file on disk still holds its copy; that a second
  write keeps the id it minted; that an agent copied from another install is still told apart and that install's id
  is not handed on either. `server.agent-id.test.js`: the real server's `/api/status` answer, whose two seeded agents
  are stopped (the rows `server.js` builds), holds neither install's id anywhere.

## Rejected
- Stripping at each place that serves a profile. That was the first two versions of this branch. Each review found
  another exit, and a new one would be one `readProfile` away.
- Stripping `id` too. The agent's own id is a different question (the board answers it through `store.agentId`, which
  refuses an id minted under another install, while the raw one rides in the profile). Noted on the card; not decided
  here.
- Not storing the copy at all. `agentId` and the stamp both compare it.

## Verify
- `node --test engine/status.cardnoinstallid-5995.test.js`: 5 pass. `node --test server.agent-id.test.js`: 2 pass.
- Mutants, each applied and confirmed applied, then restored byte for byte:
  - `readProfile` answers with the whole record -> the store test and both card tests red by name, and the real-server
    test red;
  - `writeProfile` answers with the whole record -> the store test red by name (the real-server test stays green: it
    does not save a profile).
- Every test file that names `idInstall`, `agentId(` or `stripIdentity`, plus the status, store and reachable suites,
  one file at a time, all exit 0: `engine/create.test.js` 229, `engine/status.test.js` 236,
  `render-talk-goldencard-2519.test.js` 35, `engine/worldimport.test.js` 34, `server.provider-accounts-3296.test.js` 23,
  `engine/status.paneless-roster.test.js` 10, `engine/agentfile.test.js` 9, `engine/store.test.js` 8,
  `engine.reachable.test.js` 7. `server.test.js` was left for the full suite.
- NOT run yet: the full suite, and any browser check. The page does not read the field; that is reasoning from a
  search, not a look at the page.
- NOT driven: the profile save route over HTTP. What it answers with is `writeProfile`'s answer, which is held.

## Weakest premise
That no caller needs the copy from a profile it read. It rests on the search above. A caller that copies a whole
profile somewhere and expects the install's id to travel with it would not name the field and would not be found; it
would now lose one key. The store's own writes are not affected: they start from the record on disk.

## What would change this
A consumer that needs to tell, from a profile alone, which install made an agent. Then give it a yes or no (as
`store.agentId` does), never the id.

## Order with the item 3 branch (installidwords-5995)
Item 3 merged first (kosmos#6018, on main as 4dfbcaad1), so this branch did the second-to-merge work after merging
main in: `engine/installid-senders-5995.test.js` no longer lists the recorded card fixture among the files that hold
`idInstall` (it no longer does), and the two sentences that said `engine/status.js` serves the profile's copy
(`engine/ping.js`'s list, and that test's header) say what is true now: the store hands a profile on without it.

## Review 1 (2026-10-12, default model)
- **WARNING, taken, then replaced by the change above:** the answer to a profile save carried the id.
- **NITs, taken:** the file list above; the no-pane test seeds its own profile; a stored value that is an array is
  passed on as it is.

## Review 2 (2026-10-12, sonnet)
- No blocker, no warning. **NITs, taken:** a test count; a text check that missed two ways to pass a saved record on.
  That text check is gone with the change above.

## Review 3 (2026-10-12, default model)
- **WARNING, taken by moving the rule:** a stopped agent's row, built in `server.js`, still served the whole profile.
  It was the third exit in three rounds, and review 2 had recorded "no other path". So the rule went to where the
  record is read. The real-server test now reads those rows.
- **CONVENTION, taken:** the text check on three source lines claimed more than it held. Removed; the tests assert on
  what is answered.
- **NIT, taken:** the file list said how it was counted and did not say `server.js` matches only inside another word.
- **NIT, gone with the change:** the helper's comment named cards as its only use.
- The design changed after this round, so rounds 1 to 3 are history, not convergence.

## Review 4 (2026-10-12, sonnet), at ef049382e
- No blocker, no warning, no convention finding. NITs only, not applied. The first clean round on the design that
  moved the rule into the store.

## What the full suite found (2026-10-12 21:49 CDT, at ef049382e)
19664 tests, 1 failed, and the failure was this change: `engine/store.fsync-5434.test.js` compared the bytes a profile
save writes to the save's ANSWER re-serialized. The answer no longer carries the install's id and the file still does,
so the two differ on purpose. The search under "Weakest premise" looked for callers that name the field; this test
never names it, which is the kind of caller that premise said would not be found.
- The test now compares the file to its own record re-serialized (the format, no trailing newline), and the answer
  to that record less the one key, with a control that the file does hold the id.
- Proven on a copy: with `writeProfile` answering the whole record again, that test is red by name (17 pass, 1 fail).
- No other test in the suite failed, so no other test took a save's answer or a read profile for the stored record.

## After merging main (4dfbcaad1), on the merged tree
- The second-to-merge work above. `node --test engine/installid-senders-5995.test.js`: 8 pass.
- This branch's tests and every file named under Verify, plus the two above, in one run: 617 pass, 0 fail.
- The source-sweep guards: 180 pass. Every `web*.test.js`: 2752 pass.
- NOT run on the merged tree: the full suite (PR CI is that run), and any browser check.
- The fsync test, the two sentences and the set entry are changes no reviewer had seen before review 5.
