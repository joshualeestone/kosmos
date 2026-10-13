# communityready-5958: each agent's community readiness, and what Kosmos did on its own

Card kosmos#5958, items 4 ("Say what is automatic") and 5 ("Readiness per agent"). From the Windows agents' 0.7.38 QA
(Josh, 2026-10-12 10:01). Items 1 to 3 are on other branches (PR #5988, kosmos-community `oneaddr-5958`, kosmos-relay
`digestnames-5958`).

## What the card asks
- Item 4: Kosmos reminds an idle agent and the agent decides what to write. Label each step: reminder delivered,
  agent chose to post, queued, published, or held.
- Item 5: per agent: site reachable, CLI read OK, instruction block on disk vs loaded this session, registration,
  last prompt, last post state, any hold.

## What already exists, measured on origin/main f0d9f8a65
- Queued, published and held are already recorded and worded per item (`engine/communitystatus.js`, POST_WORDS).
- The instruction block in the file: `instructions.read` + `projects.findBlock` (the turn pass's own `inCommunity`).
- A re-read the board still owes an agent: `engine/instructionreread.js` readOwed.
- Registration: `communitysend.hasAccount`.
- What is NOT recorded: what a reminder did. `communityturn.tickOnce` books only the time of a try; whether it was
  placed, not reached, or held goes to stdout and is lost. So "reminder delivered" cannot be said today.

## The call
Two slices. This branch is slice 1.

**Slice 1 (this branch): the record and the read.**
- `engine/communityready.js`, read-only apart from one small file:
  - `noteTurn(result, now)`: the turn pass's own result (`prompted`, `not-reached`, `pane-busy`, `held`, `limit`) kept
    per agent in `community-turn-last.json` in the data root, newest only. Called by `communityturn.tickOnce` itself.
  - `rowFor(session)`: one agent's readiness from the board's records only, no call to the community service:
    the switch, whether Kosmos may send to the address, the block in its file, a re-read still owed, a community
    account, the last reminder and what it did, the newest post and its state, how many items are held.
  - `readyText(session)`: that row as the lines `kosmos community ready` prints.
  - `rowsFor(roster)`: every agent's row, for the owner.
- `GET /api/community/read?ready=1`: the caller's own row as text, keyed on the authenticated session like
  `?status=1`. `kosmos community ready` in both CLIs (install/kosmos and tools/windows/kosmos-cli.js).
- `GET /api/community/ready`: every agent's row, behind the board token, for slice 2.

**Slice 2 (next branch): the board.** A list under Settings, Automation, community: one row per agent with the same
words. It changes `web/index.html`, so it needs its browser check, design shots and a design review, and it should not
hold slice 1.

## Words (item 4)
Each line says who did it. Kosmos's own acts are named as Kosmos's; an agent's post is named as the agent's. The
words live in `engine/communityready.js` (TURN_WORDS, HELD_WORDS, UNCONFIRMED_WORDS, ACCOUNT_WORDS) and are not
repeated here, so this file cannot drift from them. The rules they follow:
- "delivered" only for a line Kosmos saw land. One it could not confirm says so.
- A held line says why (a question on screen, a usage limit, signed out, the shared Google quota, the person's cap on
  agents working at once). A reason with no words gets a neutral line, never a guessed one.
- "A reminder only asks. Whether to post, and what to say, is the agent's own decision."
- The newest post, in communitystatus's own words (queued, published, held and the rest).

## Deliberately not in the row
- **Site reachable / CLI read OK.** A row built from records cannot say the service answers now, and a live check per
  agent per view is a call per agent to a public service. The agent can run `kosmos community read` itself; the line
  says so. A recorded "last good read" per agent would be a new write on every read, which this slice does not add.
- **"Loaded this session."** The board cannot see what an agent holds in memory. It can say what is true on disk and
  what it knows it still owes: "in its instructions" and "Kosmos still owes it a re-read of this section". A block
  added to the file while the agent ran, with no re-read owed, cannot be told apart from one it loaded at start. The
  row says the block is in the file; it does not claim the agent has read it.
- **The instruction block text.** Naming `kosmos community ready` there would change the rules text and owe every
  agent a re-read for one line. The command is in the CLI usage; the block can pick it up with its next real change.

## Rejected
- **Persist every reminder, as a history.** The card asks for the last one. A history is another file that grows.
- **Derive "delivered" from the tries book.** A try is booked whether or not it reached the agent (so that an
  unreachable agent backs off). Reading it as "delivered" would be false for exactly the agents this view is for.

## Verify
- `engine/communityready.test.js`: each field against a real data root (the switch off, no block, an ambiguous block,
  a re-read owed, no account, each reminder outcome, a queued post, a held post, an unreadable turn file), and one
  agent never sees another's row. Each test names the wrong answer it would catch.
- The route: `?ready=1` with another read flag is a 400, as `?status=1` is.
- Mutants, each run on 2026-10-12, each red at the named test, each restored and compared byte for byte:
  - the pass does not keep its result: red at "the real turn pass records what each reminder did";
  - any owed section reads as a community re-read: red at "a re-read Kosmos still owes";
  - an unreadable reminder record reads as empty: red at "a reminder record that cannot be read";
  - a comment counts as the newest post: red at "the newest post and its state";
  - two community sections read as one: red at "the block: there, not there, there twice";
  - the route takes the agent's name from the query: red at "ready=1 answers with the authenticated agent's own row";
  - ready with status is let through: red at "ready=1 goes alone";
  - a result with no words is kept: red at "noteTurn refuses a result it has no words for".
- Not run: the row on a real board with real agents. Every test uses a sandboxed data root.

## Weakest premise
That the newest post's state is what a person wants to see first. An agent whose newest post is fine and whose
second newest is refused sees nothing wrong in this view; `kosmos community status` lists every one, and the last line
of the text points there.

## Corrected while building
The first version recorded a reminder from the server's `log` callback. No test runs the board's turn timer, so a
board that never called it would have passed every test (the record would simply stay empty and read "none on
record"). The pass now keeps each result itself, in `communityturn.tickOnce`, and the test goes through the real pass
with no log at all.

## What would change this
An agent or a person reading a row and still not knowing why nothing was posted. Then the missing field is the next
slice, before the board list.

## Review 1 (2026-10-12, default model)
- **WARNING, taken:** the account line used `communitysend.hasAccount`, which answers a delete's confirmation and says
  yes for an unreadable file, another address's key and a refused account. The row now reads this address's keys and
  has words for each state.
- **WARNING, taken:** "held" was worded as a provider quota; it covers five holds, and the person's cap must never be
  called a quota. The pass hands the hold's reason to the record, and each has its own words.
- **WARNING, taken:** "delivered" was said for a paste Kosmos could not confirm. The delivery state is kept.
- **WARNING, taken:** an unreadable roster answered 200 with no agents. It is a 503.
- **WARNING, taken:** nothing proved `GET /api/community/ready` needs the board token. A control is in
  `server.community-gate.test.js`, beside its siblings.
- **WARNING, taken:** an agent named `constructor` got a function as its reminder and a 500. Lookups are own-property.
- **WARNING, taken:** a connected agent was promised a section Kosmos never adds to its file.
- **CONVENTION, taken:** this file's Words section had drifted from the code. It no longer repeats the words.
- **NIT, taken:** the account line named only posts and comments as what makes an account; a stray indent in the
  Windows CLI.
- **NIT, not taken, each a known limit of this slice:**
  - the row does not carry the reminder pass's own gates (the Prompter's switch, live execution), so "none on record"
    does not say why. This is the first thing "What would change this" names.
  - `rowsFor` reads the send records once per agent. Fine for the command; slice 2 puts it on a page and should read
    once for all rows before it does.
  - records are never pruned, so a new agent made under a deleted agent's name shows the old agent's last reminder
    until its own first one.
  - an agent skipped before the pass tries it (already held on quota) leaves no record, so its line shows an older
    result.

## Review 2 (2026-10-12, sonnet)
- **WARNING, taken:** at the hourly limit the pass stops, and the due agents behind the one it stopped at kept an
  older result. Each is now recorded as not sent for the limit.
- **WARNING, taken:** a new hold reason in `chat.js` would get the neutral line with nothing failing. A test reads
  chat's hold reasons from its source and requires words for each.
- **WARNING, taken:** a reminder record that was not a record refused every later write until someone deleted it. It
  holds only newest results, so the next write replaces it. A file that cannot be opened is still left alone.
- **NIT, taken:** the address line now says to tell the person; the route's comment no longer calls the read cheap;
  the ready branch refuses `status` itself. That last one cannot be shown by a test: the status branch runs first and
  refuses the pair already (a mutant that removes it stays green), so it is there for a future reorder only.
- **CONVENTION, not taken:** the `kosmos community read` usage line names neither `--ready` nor `--status`. Both are
  reached by their own verbs, which the usage does list; the flags are how the verbs are carried, not something to type.
- Mutants added, each red by name and restored: the limit's remaining agents not kept; a non-record not replaced; a
  file that cannot be opened replaced; the cap's words removed; the hold's reason dropped by the pass; a refused
  account read as yes.

## Review 3 (2026-10-12, default model)
- **BLOCKER, taken:** `tools.windows-kosmos-cli-verbs-parity.test.js` pins the Mac community subcommands and did not
  list `ready`. Only the full suite runs it, and the full suite had not run on this branch.
- **WARNING, taken:** a reminder time no date can hold made the agent's whole answer a 500. Such a record is ignored.
- **WARNING, taken, by changing what is kept instead of patching the limit again:** review 2's fix made every pass at
  the hourly limit overwrite an earlier "delivered". The record now carries two things: the newest time Kosmos went to
  remind the agent and what happened, and the newest time a reminder reached it, carried forward. The line is headed
  "The last time Kosmos went to remind you", which is true of every result, and a second line says when one last
  reached the agent if the newest did not.
  Still a limit: an agent that is due but outside the pass's cut is not tried, so nothing is recorded for it that pass.
  Its line shows its last real try, with the time.
- **WARNING, taken:** "Kosmos adds it when you next start" was promised to every agent in the workers folder; the
  board-start refresh only writes to agents the roster marks as Kosmos's own. The line says which agents it is true of.
- **CONVENTION, taken:** CLAUDE.md's community row names the new module, routes and file; the record's comment gives
  its full shape.
- **NIT, taken:** the signed-out words are their own constant, so HELD_WORDS holds exactly chat's reasons.
- **NIT, not taken:** a board older than this branch ignores `ready=1` and answers the feed (as `status` did when it
  was new; the CLI and the board ship together). The gate test's with-token arm accepts 200 or 503 (the 403 arm is the
  control; a sandboxed board's roster is not this test's subject).
- Found by running the full-suite-only guards by hand after the BLOCKER (engine.reachable, fixture-discipline, the
  install and route guards): one test built roster rows by hand. It uses real fleet cards now.

## Review 4 (2026-10-12, sonnet)
Three WARNINGs, none taken, each read against the code:
- **One flushed write per agent tried.** `communityturn.due` returns at most MAX_PER_PASS agents, which is 2, and a
  pass runs every 15 minutes. That is at most two small writes a quarter hour. Batching them would add a second code
  path for a cost that is not there.
- **"The last time Kosmos went to remind you" for an agent stopped by the hourly limit.** That agent was due, was in
  the pass's cut, and was not sent to because of the limit; the line says so, with the time. The reviewer's own reading
  is that it is true. Agents outside the cut are not stamped (review 3's limit, above).
- **A record file whose every entry is invalid reads as "none on record".** Entries are judged one at a time on
  purpose: review 3 needed one bad time to cost one agent's record and nothing else. A file that is not a record at
  all still reads as unreadable. A file of only bad entries holds nothing a reader could have shown.
- **NITs, not taken:** `accountState` reads `communitysend._paths.keysFile()`, as `communitystatus` and
  `communitymine`'s tests do; the usage line (review 2's CONVENTION again).

No new finding to act on, so the loop ends here: four rounds, two models.

## After review 4: main merged in, and why the loop did not end there
Review 4 raised three WARNINGs and I took none. By the loop's own rule a round that raises something new has not
converged, whatever is done with it, so "the loop ends here" above was wrong. It went on at review 5.
Before that round the branch was 109 commits behind main and no longer merged cleanly: `engine/communityblock.js`'s
export list had gained one name on main (my own #5988) and another here. Main is merged in with both names kept.

## Review 5 (2026-10-12, default model), on the merged branch
- **WARNING, taken:** "The last reminder that reached you" was said of any reminder that was tried, including a
  paste Kosmos could not confirm, in a file that refuses to call such a paste delivered. `reachedAt` is now kept only
  for a result whose delivery is `placed`, and the line is shown whenever the newest result is not one of those.
- **WARNING, taken (review 1 had it as a NIT, left as a known limit):** the record was never pruned, so a new agent
  made under a removed agent's name was told the old agent's reminders. The pass now hands the record the roster's
  session names and it keeps only those (and the one being written). No roster, or an empty one, prunes nothing.
- **NITs, not taken:** the lines mix "you" and "this agent" (slice 2 rewrote these words; that slice is stacked on
  this one); an address read that throws reads as "not one Kosmos sends to" (the read swallows its own errors today);
  the off-and-absent pair of lines; one write per agent at the limit (review 4's answer); two comments.
- Mutants for the two fixes, in a throwaway worktree, each red by name: an unconfirmed paste counted as reached; the
  reached time not carried forward; the record never pruned; an empty roster pruning; the pass not handing over its
  roster (green at first: nothing drove the real pass with a stale entry; the pass test now seeds one). A sixth
  mutant, removing a line that kept the agent being written, stayed green because the line did nothing (the result is
  set after the prune): the line is removed.

## Review 6 (2026-10-12, sonnet): converged
Nothing at BLOCKER or WARNING. One CONVENTION, which is review 2's again and says itself "no action needed" (the
`kosmos community read` usage line names neither flag; the verbs carry them). Four NITs, not applied: the `ready`
branch refuses `status=0` where its sibling reads only `1`; two times formatted unguarded that only a test seam can
make bad; the per-agent reads (slice 2's to fix, as above); one write per agent at the limit (review 4).
The loop ends here: six rounds, models alternating, the last two on the branch with main merged in.
