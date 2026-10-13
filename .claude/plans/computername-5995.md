# computername-5995: the name this computer is sent under is shown first (kosmos#5995 item 4)

## Why
The Kosmos+ sign-in names this computer from its own name (macOS ComputerName, else the host name), by
design (#4638). That name is often a person's ("Sam's MacBook"), and it left the computer unseen.
PigeonPete's decided design is on the card (comment 6132118222): keep the default, show it before it is
sent, let the person change or clear it, and use the chosen name on every path that names this computer.

## Change
- `engine/remote.js`: `remote.json` keeps `computer_name` only when the person changed or cleared the
  field ('' is a choice). `thisComputerDeviceName()` reads it, so the three paths that name this computer
  (sign-in start, sign-in verify, the quiet approval of this computer's own sign-in) follow from ONE
  place. `ownComputerDeviceName()` is the cached read of the computer's name. `computerNameShown()` and
  `setComputerName()` are what the server calls.
- `server.js`: `GET /api/remote/computer-name` (refused to another website) and `computer_name` on
  `POST /api/remote/signin-start`. The name RIDES that start (as the label the tunnel is given) and is kept
  only after the start went out. `device_name` keeps its meaning (a caller naming some OTHER device).
- `web/index.html`: a "Name for this computer" box on the email step. It is hidden until the route has
  answered, then shown filled; the start waits for that read and sends the box's text. Enter in it asks
  for the code.
- Tests named `#5995`: 8 in `engine/remote.test.js`, 1 in `server.test.js`, 5 in
  `web.computer-name-5995.test.js`, 2 in `web.code-box.test.js` (which also loads the real name function). Browser check
  `docs/browser-checks/render-plus-computer-name-5995.js` drives the real page and the real routes.

## Decided
- **Stored only when it differs from the computer's own name.** An untouched field keeps nothing, so a
  renamed computer is still followed. Rejected: always storing what was shown (it would freeze the
  name at the first sign-in for everyone who never touched the box).
- **A small local GET, not a field on the remote status.** The status travels to every page poll.
  Rejected: adding the name to `/api/remote`.
- **The box is not on screen until its name has been read, and sends nothing until then.** Its words
  ("An empty box sends This computer") are only true of a box that showed a name, so a failed read
  shows no box at all and the start behaves as before this change (review 1: the first version showed
  the box and its words either way). The cost, stated: when the read fails, the name goes unseen, as
  it always did. The read is local; it fails when the board itself is failing.
- **Nothing is written when nothing changes.** An untouched box creates no remote.json and is not
  refused on a damaged one (review 1 measured both going wrong). A real choice repairs a damaged file,
  as the sign-in's other writes do.
- **Forgetting this computer keeps the chosen name.** It is shown again before it is sent again. Pinned
  by a test. NOT kept: a Forget on a DAMAGED remote.json, whose first write starts from the defaults;
  the next sign-in then shows the computer's own name in the box, where the person can change it.
- **A cleared box sends "This computer"** (the card's call), shown as the box's placeholder.
- **The company sign-in is unchanged.** It has its own name box (#5628) and its own request.

## Weakest premise
That a person looks at a prefilled box before pressing the button. The box makes the name visible; it
does not make anyone read it. Second: a phone reached through the relay can read the route too. That is
the person's own allowed device, and the same name is already in their device list.

## Verify (what ran, and on which head; the full suite is not in this list)
- At 16d4ab23e (the review 4 redesign): every `web*.test.js` 2744 pass, 0 fail (ick-5995-cn-r4fix.log).
- At 16d4ab23e, 18 mutants, each red by name in a throwaway worktree at that head: the chosen name ignored by the
  later paths; the computer's own name kept as a choice; the quiet approval naming the computer itself; the
  choice's label differing from what keeping it sends; a glued ending stripped; an unreadable file repaired for a
  name; an untouched box writing; the start sent without the typed name; the name kept BEFORE the start; the name
  never kept after it; a cleared box told to show a name; another website reading the name; the start retrying a
  failed read; no give-up on the read; the box shown though the read failed; the start not waiting for the read;
  the start not sending the name; the box not updated to the kept name.
- At the head of the review 5 commit: `--test-name-pattern='#5995|#3831' engine/remote.test.js` 10 pass;
  `--test-name-pattern='#5995' server.test.js` 1 pass; `web.computer-name-5995.test.js` and `web.code-box.test.js`
  12 pass. The web sweep, the whole `engine/remote.test.js` and the mutants are owed again at the final head.
- NOT yet, and each is owed before the proof: the browser check (queued since 16:35; it has NEVER run, so its
  layout, contrast and real-route lines are unproven), the full suite, a look by a person or a design review.

## Review 1 (default model)
4 WARNING, 3 CONVENTION, 3 NIT (the last NIT and anything after it were cut off in delivery and asked
for again).
Taken: a damaged remote.json blocked the sign-in start, and an untouched box wrote a file (read()'s
early returns now carry `computer_name: null`, nothing is written when nothing changes, a real choice
repairs); the page said "An empty box sends This computer" beside a box that had read no name (the
box is hidden until read, and the start waits for the read); the Forget decision had no test (added,
and the damaged-file case stated above); the server comment now says a refused start keeps the name;
the browser check printed names on a failing line (it prints matches and lengths).
Not taken, with the reason:
- "the plan file needs a timestamp": every plan in `.claude/plans/` is `<branch>.md`.
- "commit subjects should be `<branch> -- <message>`": the PR is squash-merged under its title, which
  will use that form.
- "CLAUDE.md Where to Find Things gets no entry": that table is for moved files, changed commands and
  new directories; the sibling route `signin-addresses` has no row either.
- "`thisComputerDeviceName()` reads remote.json on every call": two or three small reads per sign-in
  step, and one read passed through would thread a parameter through three callers.

## Review 2 (sonnet)
**SUPERSEDED where it describes `putBackComputerName`, `was` or `computerNameTurn`: that code was removed at Review 4
(the name now rides the start and is kept after it). Kept as the record of how the design got there.**
3 WARNING, 1 CONVENTION, 2 NIT, plus the four NITs of review 1 that arrived late.
Taken:
- a name was kept by REPAIRING remote.json whenever it read badly, including when it could not be read at all for
  a passing reason (the file may be whole): a real choice now repairs only a file that holds unreadable text, and is
  refused when the file cannot be read at all. An untouched box is still never refused.
- a start that did not go out left the typed name kept, and it would then name this computer on a later, unrelated
  approval: the server puts back what was kept before (`putBackComputerName`), so a name is only kept once a start
  carried it. Tested with a tunnel that fails the start.
- the start waited on a read with no limit: the read is given up on after 3 s, which is a failed read (no box).
- the four empty-settings literals in `read()` are one `blankSettings()` (the convention finding; it is what let
  `computer_name` go missing from three of them).
- late NITs: a typed " (Kosmos app)" ending was sent twice (stripped now, and the hint says the account shows the
  name with that ending); an assertion that compared a value with itself; the browser check gets a phone-width,
  light-theme pass.
Not taken:
- "the fallback This computer is stored as a choice when typed text is unusable": the person did type something;
  it behaves as a cleared box does.
- "read remote.json once and pass it through" (second time raised): the reason in Review 1 stands.

## Review 3 (default)
**SUPERSEDED where it describes `putBackComputerName`, `was` or `computerNameTurn`: that code was removed at Review 4
(the name now rides the start and is kept after it). Kept as the record of how the design got there.**
2 WARNING, 2 CONVENTION, 6 NIT (one more was cut off in delivery and asked for again).
Taken:
- two overlapping starts could undo a name one of them carried (the first keeps "B" and fails late, the second
  found "B" kept and went out, the first's put-back cleared it). Keep, start and put back are now ONE step, one
  request at a time (`computerNameTurn` in server.js). Tested with two requests at once and a stand-in that fails
  only the first.
- the plan's test counts and Verify lines were stale (rewritten above, saying which head each ran on).
- a put-back that cannot be saved is logged (never the name); test messages no longer print this computer's name;
  after a start, the box shows the name as kept, so coming back to the step shows what was sent.
Recorded, not fixable in a review round:
- "the verification behind the head is thinner than the change": true, and the Verify section now says exactly
  what is owed. The browser check has waited in the machine's suite queue since 16:35.
- a start that fails on a remote.json holding unreadable text leaves that file repaired and keeping nothing: the
  repair is the sign-in's own behaviour (#4308), and nothing readable was lost.
Not taken:
- commit subjects (second time): this PR is squash-merged under a title in the repo's form, as #5988 was.
- warming the computer's name before the wizard opens: it would run `scutil` at every board start for a screen
  most starts never open. The box appearing moves the button once; the start waits for the read either way.
- dropping `fromComputer` from the route: the browser check and the server test read it to tell the arms apart.

## Review 4 (sonnet), and the design change it led to
3 WARNING, 1 CONVENTION, 3 NIT, and review 3's late NIT.
Two of the three WARNINGs were again in the keep-then-put-back code that review 2 asked for and review 3 patched
(a stale put-back; a put-back that cannot be saved leaving a name no start carried). Three rounds, one new exit
each. So the mechanism is gone, replaced by ONE rule: **the name rides the start and is kept only after the start
went out.** `computerNameChoice()` works out, without touching remote.json, what a typed text keeps, sends and
shows; the server passes its label to the start and calls `setComputerName()` afterwards. There is no put-back, no
"what was kept before", and no one-at-a-time lock, because a start that does not go out has changed nothing.
- The one gap this leaves, stated in the server comment: a start that went out followed by a save that fails. It is
  answered as a failure and the person asks again.
- WARNING taken: after a failed or given-up read, each press of the button waited the whole 3 s again. The start no
  longer retries a failed read; showing the email step does.
- NITs taken: a typed ending glued to a word is part of the name; a box the person emptied stays empty after the
  start (the board answers '' for it); the browser check measures the explanation's contrast against the card
  behind it, in both themes, where it used to compare two colours for inequality.
- CONVENTION (what is owed before the proof): unchanged, listed under Verify.
- Not taken: "typing the computer's own name follows the computer" is the design (Decided, first line).
Earlier sections of this plan that mention `putBackComputerName`, `was` or `computerNameTurn` (Reviews 2 and 3)
describe code that no longer exists.

## Review 5 (default), the first on the name-rides-the-start design
4 WARNING, 2 CONVENTION, 4 NIT.
Taken:
- a start could go out (a code emailed) and then be answered as a failure because the name could not be kept, and
  for a settings file that cannot be read at all that happened on every try: `canKeepComputerName()` is asked
  BEFORE the start. The gap that is left (the save failing all the same) now says a code was sent.
- "two starts cannot undo each other" was only true of a failing one, and only tested with one name: the comment
  says what holds (a failed start changes nothing) and what does not (two different names at once keep the last
  saved).
- a typed name starting with "-" was handed to the tunnel as an option's value: leading hyphens are dropped.
- the Verify section described code that no longer exists (rewritten above).
- a test title and two comments still described keep-first.
- a cleared choice was shown as the text "This computer" at the next sign-in, and one press turned it into a typed
  name: it is shown as an empty box now, in the engine, the server test and the browser check.
- the ending is looked for again after the cut; the fast-Enter comment says what is true of it.
Not taken (third time): the plan's file name and the commit subjects (reasons in Review 1 and 3).

## Review 6 (sonnet)
2 WARNING, 1 CONVENTION, 3 NIT.
- WARNING, already decided, now also said in the code: Forget keeps the chosen name (Decided, above; pinned by a
  test since review 1). A comment beside Forget's write says why.
- WARNING taken as a test: the one stated gap (the start went out, the save then failed) is now driven for real (the
  stand-in tunnel makes the settings file unreadable while the start runs): the answer says a code was sent and the
  name was not kept, carries no kept name, and the stored name is unchanged.
- CONVENTION taken: `setComputerName`'s doc comment sat above `canKeepComputerName`; it is above its own function.
- NIT taken: the comment says `computer_name` takes `device_name`'s place when both are sent.
- NITs not taken: passing a precomputed choice around (the derivation is pure and one function); a test for the
  fast-Enter path beyond the wiring assertion (the comment states what it does).

## Review 7 (default)
1 BLOCKER, 3 WARNING, 4 CONVENTION, and it is the round that showed what the unrun full suite was hiding.
- BLOCKER taken: two of my new tests compared `process.platform` with 'win32', which reddens the suite guard
  `engine/windows-tests-1777.test.js`. Both now PROBE (make the file mode 0; skip if this host still reads it),
  which also covers an administrator. I then ran every guard test that scans sources or the browser-checks folder
  (157 tests) and it found a SECOND miss of the same kind: the new browser check was not in
  `docs/browser-checks/gated.txt`, so `tools.browser-checks-wired.test.js` failed. Wired. Both would have been
  caught by the full suite, which is still owed.
- WARNING taken (third time raised): in the stated gap (the start went out, the save failed) the answer is now the
  code step with `computer_name_kept: false`, and the page says the name was not saved; the code that was emailed
  works. It was a 400 that told the person to ask again.
- WARNING, recorded, not changed: while remote.json cannot be read at all, every path (start, verify, the quiet
  approval) sends the computer's own name, because all three ask the same function at that time; a choice kept
  in the file comes back when the file reads again. That is the engine's behaviour for an unreadable file, not
  something this branch can decide from a blank read.
- CONVENTION taken: the leading-hyphen comment claimed more than the code does (only a TYPED name is stripped);
  an untouched box on a computer whose own name starts with "-" is now untouched (compared before anything is
  taken off); the fast-Enter comment said "the computer's own" where a kept choice is also possible.
- Not taken (fourth time): commit subjects; the PR is squash-merged under a conforming title.
- Owed, unchanged: the full suite, the browser check (never run), a design look. The branch is rebased onto main
  after this commit.

## Review 8 (sonnet), the first after the rebase onto main
3 WARNING, 3 NIT. The reviewer called one "probably acceptable", one "not a blocker", one "no defect".
- WARNING, recorded in Review 7, now stated in the code and pinned by a test: while remote.json cannot be read,
  the box shows the computer's own name and every path sends it.
- WARNING taken as a sentence: the question asked before the start is not a promise about after it (another
  request can change the file while the start is out); the comment on the one gap now says so.
- WARNING, "no defect": the late-read guard on the page compares the read with itself where the rest of the flow
  uses an epoch. Left: it is the smaller of the two and tested.
- NITs taken: the choice and the read are worked out once per call (third time raised); a test that a typed name
  always passes the tunnel's rule for a name, so it is never swapped for the plain one. Not taken: an unreachable
  refusal branch in the route (harmless, and it is what makes a later change to the engine's refusals safe).

## Review 9 (default)
3 WARNING, 5 CONVENTION, 4 NIT.
- WARNING taken: a name made only of characters nobody can see (zero-width, direction marks) was kept as a name and
  looked like a cleared box; those characters are removed first, so it IS a cleared box, and a direction override
  cannot sit inside a name. Half of a character pair on its own is replaced.
- WARNING, recorded since Review 7: while remote.json cannot be read at all, an untouched start sends the
  computer's own name, and a choice still in the file comes back when it reads again. The unreadable-at-all half
  now has the same assertion as the damaged half. The behaviour is unchanged.
- WARNING, the owed verification: unchanged, and it is what stands between this branch and its proof.
- CONVENTION taken: the route's comment told the story of earlier versions (it now says what the code does, as a
  list, with no long line); a comment at Forget claimed the quiet approval "only ever follows a sign-in that
  showed it" (false on the fast path; removed); the plan's test counts; and "worked out once" was not true of the
  ROUTE, which now holds one choice and passes it to `canKeepComputerNameChoice` and `keepComputerNameChoice`.
- CONVENTION, not taken (fifth time): the plan's file name and the commit subjects.
- NITs taken: two stale "shows the plain name" comments; a test that `computer_name` wins over `device_name`.

## Review 10 (sonnet)
2 WARNING, 3 NIT.
- WARNING taken, as a rule and not as more entries: the list of invisible characters I wrote in round 9 missed the
  Hangul fillers and the variation selectors. It is now Unicode's own property for characters that draw nothing
  (`Default_Ignorable_Code_Point`) plus every format character, so there is no list to be short. Tested with the
  ones the list missed, and with a control that Korean letters, an umlaut and an emoji are still names.
- WARNING taken as a sentence: `thisComputerDeviceName()` reads the settings file on each call; the comment says so.
- NIT taken: the route's line about two starts said more than the engine allows (it refuses a start while a step
  is busy). Not taken: a comment about a fetch that rejects after a clear (the code beside it already says a
  read left over from a cleared sign-in is dropped).

## Review 11 (default)
3 WARNING, 2 CONVENTION, 4 NIT. Two warnings were against the Unicode-property strip I added one round earlier.
- WARNING taken: stripping every character that draws nothing changed REAL names (the joiner inside an emoji of
  several parts, the selector that makes a heart red, the Persian word joiner), and made an untouched box read as
  typed on a computer whose own name holds one. Now: (1) "left as it was" is told by comparing the typed text, as
  one line, with the computer's own name BEFORE anything is taken off; (2) only the direction controls are removed
  from a typed name; (3) a name with nothing in it that draws is a cleared box, asked without changing the name.
  Tested with the names that were being changed.
- CONVENTION taken: "one line" was derived twice (in `deviceNameFrom` and in `computerNameChoice`) and the two had
  already drifted; it is one function, `oneLine`, used by both.
- CONVENTION taken: Reviews 2 and 3 are marked superseded where they stand.
- WARNING, the owed verification: the runs cited at 16d4ab23e predate the rebase. What has run since, at d8aef0157
  (the rebased head, three small commits ago): web sweep 2750 pass, guard tests 180 pass, whole
  `engine/remote.test.js` 224 pass. Still owed at the final head: those three again, the mutants, the browser check
  (never run), the full suite.
- NITs not taken: a "use this computer's name" control (a feature; typing the name back does it); why the page
  says "may" (the comment beside it says a disk failing between two writes).

## Review 12 (sonnet): converged
1 WARNING, 4 NIT, nothing new.
- WARNING, a duplicate of Review 8's NIT, and already pinned: "if `DEVICE_NAME` is ever tightened, a typed name
  could be swapped for the plain one". The reviewer could find no input that reaches it today. Review 8 added the
  test that fails the day that changes ("a typed name always passes the tunnel's rule for a name").
- NITs: three ask for tests that exist (a cut landing on a typed ending; `computer_name` over `device_name`); one
  notes that `setComputerName` and `canKeepComputerName` are wrappers the tests use (true: each is one line over
  the function the server calls).
The loop ends here: eight rounds on the name-rides-the-start design (5 to 12), models alternating.

## After convergence: mutants at 2d417473b, and one test they asked for
31 mutants in a throwaway worktree at 2d417473b; BASE green for each of the three test groups first. 29 red by name.
Two read green, and both are the same thing: the two places that say "this is the computer's own name, keep
nothing" each cover for the other.
- The second place (`kept === own`, after the ending and hyphens are taken off) had no test of its own. Added one
  (the own name typed with " (Kosmos app)" after it): that mutant is red now, and removing both places reds five.
- The first place (`asTyped === own`, before anything is taken off) differs from the second only on a computer
  whose OWN name starts with a hyphen or holds a direction mark. A test host's name is what it is, so no test here
  can make that case: **removing the first place alone is invisible to this suite.** Stated, not closed.
The red ones: the chosen name ignored by the later paths; the quiet approval naming the computer itself; the
choice's label differing from what keeping it sends; direction controls kept; every invisible character stripped
(round 10's version); a name that draws nothing kept; a leading hyphen kept; a glued ending stripped; an
unreadable file repaired for a name; an untouched box writing; a cleared choice shown as text; Forget dropping
the name; the start sent without the typed name; the name kept before the start; never kept after it; no
question before the start; the gap answered as an error; a cleared box told to show a name; another website
reading the name; and on the page: the start retrying a failed read, no give-up on the read, the box shown though
the read failed, the start not waiting for the read, not sending the name, the box not updated to the kept name,
nothing said when the name was not kept.
The one line added to `engine/remote.test.js` after review 12 is the only change no reviewer has seen.

## After convergence, second finding by a guard: two wrappers nobody but tests called
The reachability guard (`engine.reachable.test.js`), run at 2d417473b with the other guard tests, went red:
`setComputerName` was exported and tested and reached from no screen, because since Review 9 the server calls
`keepComputerNameChoice` and `canKeepComputerNameChoice`. Review 12 had noted the same as a NIT. Both wrappers
(`setComputerName`, `canKeepComputerName`) are removed; the tests keep a name the way the server does, through
the two functions the server calls. So the tests no longer exercise a path the product does not have.
Earlier sections of this plan that say `setComputerName()` mean `keepComputerNameChoice(computerNameChoice(text))`.
This is a code change after the round that converged, so one more blind round follows it.

## Review 13 (default), after the wrappers were removed
2 WARNING, 5 NIT. Both warnings are one fault of mine, and a real one.
- WARNING taken: the direction controls in `computerNameChoice`, and the test strings beside them, were in the
  source as RAW invisible characters, not as escapes. I had typed escapes; the tool I write files with turned them
  into the characters. Nothing on screen shows the difference, and a raw override character even reorders how its
  own line displays. Every character outside plain ASCII that this branch adds is now an escape (checked by code
  point over the whole diff: none left), and a test fails if `computerNameChoice`'s source holds anything else.
- WARNING taken: only two of the twelve direction controls had an assertion. Each has one now, by code point,
  both inside a name and alone.
- NIT taken: half a character pair alone (an emoji cut by the box's length limit) is a cleared box.
- NITs not taken: a lower-case "(kosmos app)" typed by hand is part of the name, as the glued form is; invisible
  characters inside a name that draws stay (the comment now says so); an unreachable refusal branch; where the
  one-time read of the computer's name lands.

## Review 14 (sonnet): converged
0 BLOCKER, 0 WARNING, 3 NIT, and a caution that this plan's mutant list must stay true to the code (it is rerun
at the final head, below). The reviewer read the three product files and did not read the tests in detail.
NITs, not applied: `keepComputerNameChoice` answers a `name` its one caller does not read; `ableToKeep` reads the
file a second time to tell "absent" from "unreadable" (it says why); sending both `computer_name` and
`device_name` is not refused.
The loop ends here at 14 rounds: 4 on the first design, 10 on the name-rides-the-start design, models alternating.

## The first real browser run (2026-10-12 21:54 CDT), after the review converged
The check had never run in a browser. Its first run, at b0e4ab534, was red in two files. Neither red was the page.
- `render-plus-computer-name-5995.js`, 2 red: "the explanation can be read", ratio 2.19, in dark and at phone width.
  The check walked up to the first opaque background COLOUR. The card paints a gradient, so there is none, and it
  fell back to white: 2.19 is the text's colour against white. Measured from the run's own screenshot, the painted
  text against the painted card is about 7 to 1 (brightest text pixel 159,176,208 on 22,37,70). The check now
  composites the text over each of the card's two gradient stops, read from the card, and asks for 4.5 to 1 (it
  asked for 3), with a control on the arithmetic and a failure when the card's gradient is not found.
- `render-plus-signin-3478.js`, 8 red: four counts of the sign-in card's inputs (9 and 10) in two themes and in
  WebKit. The new box is an eleventh input in the pane and a tenth in the wizard. Every separation it measures on the
  ten passed; only the counts were old. The counts are 10 and 11 now.
- The other two checks in the run (`render-plus-signin-enter-0929.js`, `render-plus-company-5628.js`) exited 0.
- These are changes to two checks that no reviewer has seen, and neither has run since. The rerun is queued.

## Review 15 (sonnet, 2026-10-12 late), at 8ef93454b, on the two changed checks
0 BLOCKER, 0 WARNING, 0 CONVENTION, 6 NIT over two passes (the second read the rewritten contrast check in full).
None applied: the device name is read from disk per call; a typeof guard on a const gives no protection; the
two-stage name compare is under-explained; the contrast arm does not itself check the hint is displayed (the arms
beside it do) nor an ancestor's opacity; the "dark" and "phone, light" arms measure one navy card; the colour parser
would not read color() or oklch (it fails closed).

## Main merged in, the full validation, and the surface gate (2026-10-13)
- Main (288716526, with both other #5995 changes) merged in at 9b4888434, no conflict.
- The repo's full validation at 9b4888434, finished 01:22 CDT: node 19866 tests, 19631 passed, 0 failed, 235 skipped;
  shell 232 of 232. It then failed on its LAST step, the browser-check surface gate: `web/index.html` maps Enter in
  the new box to "Email me a code", a surface `render-plus-signin-enter-0929.js` names. That check's own boxes are
  unchanged and it exited 0 in the 10-12 browser run with the new box on the page; Enter in the new box is asserted
  by this branch's own check. An empty commit (a158331ef) carries the per-check trailer the gate asks for, and the
  gate alone at that head exits 0.

## Design review (Mona Lisa, 2026-10-13, on the shots at a158331ef): approved with two changes, both taken
- The explanation read as more label: on this card a hint took the label's colour (both measured rgb(159,176,208)).
  It is now `#8fa0c4` (the card's placeholder colour), `.85rem`, directly under its label and 8px above its box.
- The explanation is one sentence: "Your Kosmos+ account will list this computer by this name." Dropped: "Change it
  if you like" (a filled, editable box says it), "An empty box sends This computer" (the placeholder says it once the
  box is cleared), and the "(Kosmos app)" ending (the account page shows it beside the name).
  **Weakest premise, hers and now mine:** that nobody is surprised to see "(Kosmos app)" after their name on the
  account page. If someone is, it comes back as a second short sentence.
- NOT taken here: Cancel is a 48x17 tap target on the phone. It is on main already, and making it 44px tall changes
  the height of every step of this card, which `render-plus-signin-3478.js` measures. Its own card.
- The browser check gains three arms for what the review asked: the hint's colour is its own, it is smaller than the
  label, and it sits closer to the label than to the box.
- At this tree: `web.computer-name-5995.test.js` and `web.code-box.test.js` 13 pass; guards 145 pass; every
  `web*.test.js` 2759 pass. NOT run: any browser check (the rerun is queued), the full suite since this change.
- These are changes no reviewer has seen. One round follows.
- Wherever this file, above this section, quotes the box's words as "An empty box sends This computer", that was the
  copy at the time; the one sentence in this section is what the page says now.

## Review 16 (2026-10-13, default model), at dc3ff2afa
1 BLOCKER, 0 WARNING, 2 CONVENTION, 3 NIT. Not converged.
- **BLOCKER, taken, and it was mine:** the design review asked for the hint "a little smaller, about .85rem". On this
  page the label is 13px (`--text-body`) and the root is 16px, so `.85rem` is 13.6px: LARGER than the label, and the
  arm I had just added ("the explanation is smaller than its label") would have gone red in the browser. I applied a
  number without computing it against the label it had to be smaller than. No size is set now: the hint keeps
  `.fhint`'s own 12px, one step under the label. Read from the CSS by the reviewer and again by me; NOT seen in a
  browser yet.
- **CONVENTION, taken:** an arm's label still quoted the sentence the page no longer says.
- **CONVENTION, taken:** the doc comment for `deviceNameFrom` sat above `oneLine`. The two are in order now (moved,
  not retyped: the file's bytes are the same set).
- **NIT, taken:** the colour arm's label says the literal is a pin. **NIT, taken:** this file marks the old copy.
- **NIT, not taken:** `box()` answers "not on screen" from the `hidden` attribute. It holds through the page's
  `[hidden] { display: none !important }`.

## Review 17 (2026-10-13, sonnet), at 51e383d13
0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT. A new warning, so by the loop's rule not converged, though nothing changes
in the code for it.
- The reviewer computed every layout and colour assertion of the browser check from the page's CSS and found each
  holds: the hint's colour and that it differs from the label's, 12px against 13px, 2px above and 8px below, the
  box's size and order at desktop, and the contrast over both gradient stops (about 5.25 on the lighter one).
- **WARNING, answered by a measurement already on record:** the one assertion it could not compute was the box's
  width at phone width (at least 200px), which depends on the Settings page's gutters. It was MEASURED in the check's
  first real browser run (2026-10-12, at b0e4ab534): `phone width, light: the box is a usable size`, PASS, width 240,
  height 44. Nothing since has changed the box, its class or the card's padding.
- **NIT, not taken:** one boolean folds "the hint stays inside the card" and "the page does not scroll sideways".
- **NIT, not taken:** a comment that `toWellFormed` needs the Node the repo already pins.

## Review 18 (2026-10-13, default model), at f7b12275b
0 BLOCKER, 0 WARNING, 1 CONVENTION, 4 NIT. A new convention finding, so not converged.
The reviewer ran this branch's `#5995` tests in `engine/remote.test.js` (8 pass) and `server.test.js` (1 pass), and
a 20-input probe of `computerNameChoice` (direction controls, typed endings, cuts at the limit, leading hyphens
behind invisible characters): every label was valid, none began with a hyphen, each was stable when fed back in.
- **CONVENTION, taken:** a comment in `server.js` said the engine refuses a start while another step is busy, so two
  starts cannot overlap. They can: a start is held back only during a Forget or a register, and this branch's own
  two-tabs test depends on the overlap. The comment now states the real rule and its consequence: from two tabs, the
  kept name can be the older tab's. The behaviour is unchanged and stays as "last save wins".
- **NIT, taken by saying it:** the doc promised "no control characters"; the class clears the ASCII ones. The 8-bit
  C1 controls are left as typed, as they always were for the computer's own name. The doc says so.
- **NIT, not taken:** `keepComputerNameChoice` answers a `name` only tests read (also raised in review 14).
- **NIT, not taken:** a `fetch` that throws synchronously would leave the name read stuck. Real `fetch` rejects.
- **NIT, noted:** commit subjects with a colon. The merge is a squash under a `computername-5995 -- ...` title.

## Review 19 (2026-10-13, sonnet), at 345e025d9: converged
0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT, neither applied (both are couplings the code's own comments already
name: the device name is read from disk per call, and "untouched box on an unreadable file writes nothing" rests on
the blank read answering null, which a test pins). The reviewer read the three product files and the check changes
in full and did not read the new test files.
The loop ends here at 19 rounds. The proof waits for one thing: the browser check green in a real browser at the
final head. Reviews 16 and 17 each computed its layout and colour assertions from the CSS and found they hold; that
is reasoning, and the run is the measurement.
