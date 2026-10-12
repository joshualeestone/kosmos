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
- Tests: 8 in `engine/remote.test.js`, 1 in `server.test.js`, `web.computer-name-5995.test.js` (5), one
  in `web.code-box.test.js`, which also loads the real name function. Browser check
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
