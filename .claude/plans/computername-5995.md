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
  `POST /api/remote/signin-start`, kept BEFORE the code is asked for. A name that cannot be kept refuses
  the start. `device_name` keeps its meaning (a caller naming some OTHER device).
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
- At 3d3cd7842 (after review 2): every `web*.test.js` 2743 pass, 0 fail; the whole `engine/remote.test.js`: see
  `REMOTE_EXIT` in the review 3 commit's note below.
- At the head of the review 3 commit: `--test-name-pattern='#5995|#3831' engine/remote.test.js` 10 pass;
  `--test-name-pattern='#5995' server.test.js` 1 pass; `web.computer-name-5995.test.js` and `web.code-box.test.js`
  12 pass. The page changed again in that commit (four lines), so the web sweep is owed once more before the proof.
- Mutants at 25357d9df (before the reviews), each red by name: the chosen name ignored; the computer's own name kept
  as a choice; the quiet approval and the start/verify naming the computer itself; the start not keeping the name;
  another website reading the name; the start not sending the name. They are owed again at the final head, with
  the new ones (the put-back removed; the starts not serialised; the read's give-up removed).
- NOT yet, and each is owed before the proof: the browser check (queued; it has never run), the full suite, a look by
  a person or a design review of the new box.

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
