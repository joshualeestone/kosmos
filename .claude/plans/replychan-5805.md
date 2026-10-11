# replychan-5805: an agent declares its reply channel, so the reminders stop calling it silent (kosmos#5805 part 2)

## The defect (the collected 10-10 report, read at the source)
An agent whose instructions said to answer the person through a different channel answered there, and a reminder then
said *nothing had reached the person*. That wording is the first-reply nudge (engine/firstreply-nudge.js); the room's
#185 reminder (messages.unanswered, its "has not answered" line, sweepUnanswered's nudge, owedElsewhere's which-room
question) calls such an agent silent the same way. Kosmos cannot see that channel.

## The change
`kosmos reply-channel "<where>"` (empty, "kosmos" or `--clear` clears it), on the Mac and Windows CLIs, POST
/api/agent/reply-channel, stored as `replyChannel` on the agent's profile (engine/replychannel.js). With one declared,
neither reminder speaks for that agent (messages.answersElsewhere, shared by unanswered and owedElsewhere; the
first-reply sweep's replyChannel reader). suspectedMisrouteCount (a daily aggregate) does not read it, and says so.

## Decided (PigeonPete took this over from Baron at 34aedd9ef)
- **The agent declares it, as the report asked.** Baron's branch had instead counted a `kosmos reply` to the person
  within an hour of a room ask as answering it, with no declaration. That cannot see the reported case (the answer
  never touched a Kosmos thread). It was kept at first beside the declaration, then **removed in review 7**: review 6
  found Kosmos rows ending its window early, review 7 found one reply clearing every room's asks for an hour (it did
  not look at the project). It was never asked for, and a third patch was the wrong direction.
- An unreadable profile counts as no declaration (today's behaviour), and a stored value the command would refuse
  counts as none.
- The route is in AGENT_TOKEN_ROUTES (every Windows agent holds a token and no board token). Its handler names the
  caller with processCaller (a token exactly; a pane as given) and sets only that agent's own channel; no name in the
  body is read. A page request carries no pane, so it names nobody (review 5 removed a screen branch no page called).
- **How an agent learns the verb:** the first-reply nudge (the report's case) ends by teaching it, and says it is
  never a way to quiet a reminder (review 7: teaching it on every reminder steered forgetful agents toward it). The
  room line is unchanged. Rejected: a line in the agents' working rules (engine/defaults.js): a doctrine change for
  every agent, with a version bump and a measured rollout, for one sentence.
- **The person cannot yet see or clear a declaration:** kosmos#5820 (follow-up, needs a page change).

## Rejected
- Automatic counting of a direct reply (34aedd9ef's call): blind to the reported case; removed in review 7.
- Reading the channel out of the agent's instructions: free text, guessed.
- Rewording the operator envelope's "to answer, run: kosmos reply" hint (the report calls it wrong for such an agent):
  engine/musefront.js recognises that envelope by its exact text, so a change breaks a parser silently. Follow-up.

## Weakest premise
A declared agent that does not answer on its channel is never reminded: the declaration removes the safety net and
nothing checks the claim. What would change it: a missed message from an agent that declared a channel; then show the
declared channel where the reminder would have been, rather than staying silent.


## Incidental fixes
- Windows help padded verbs to 13 columns, so `reply-channel` ran into its words; now the Mac's 14, widened for a
  longer verb.
- cli.help-lines-4785 and the CLI parity test read verbs with `[a-z]+`, which can never match a hyphenated verb;
  widened, with the two internal Mac arms (board-run, keep-copy) excluded by name and asserted present.

## Tests
- engine/messages.test.js: a declared-channel test (control: the same ask undeclared is owed, nudged and asked
  about; declared it is none of those; cleared, it is back).
- engine/firstreply-nudge.test.js: the real store, the sweep's own default reader, the card's own case nudged
  undeclared and not declared; an injected reader honoured, a throwing one no declaration.
- engine/replychannel.test.js: normalize, of (a hand-edited value the command would refuse is no declaration), set.
- server.reply-channel-5805.test.js: over HTTP, an agent sets only its own; refusals; the screen names a real agent.
- cli.reply-channel-5805.test.js: Mac against a stub board, Windows with fetch captured: set, --clear, bare, --help.
- Mutations (13, each restored and byte-compared): every one went red. Skip in the nudge; ignore the declaration in
  the room; old predicate in owedElsewhere; old predicate in unanswered; screen accepts any name; agent names
  another; of() unvalidated; "kosmos" not clearing; Mac --clear; Windows --clear; Mac help guard; token set; Windows
  help column.

## Review 1 (opus)
- FIXED (WARNING): unbounded window; see Decided.
- FIXED (WARNING): owedElsewhere's "owed" disagreed with unanswered; both use answeredDirectly now.
- FIXED (WARNING, by comment): suspectedMisrouteCount keeps the room-only test on purpose and says so.
- FIXED (WARNING): a thread was parsed on every render and every sweep per project; cached by mtime and size.
- FIXED (NIT): the nudge is asserted, with a control that it fires for an owed ask.

## Review 2 (sonnet, blind, on 706233b24)
- DEFERRED (WARNING): a declaration silences the room's "has not answered" line too, with no expiry, and covers asks
  made before it. By design: the person's own instructions send the agent's answers to that channel, so the line
  would be false. This is the weakest premise above; the change named there (show the channel instead) is the fix
  if it ever misfires.
- DEFERRED (WARNING): a process holding the board token can name another agent's pane (`from_pane`, taken as given).
  Accepted: the same posture as the role route; the board token is the person's credential; the token path names
  the caller exactly.
- FIXED (WARNING): the declared channel was read from disk per ask on every render; now once per name per pass.
- FIXED (NIT): the Mac turned a newline in the channel into a space where Windows refuses it; the Mac now refuses it
  in the board's words (test, with a control and a mutation).
- FIXED (NIT): the inserted block had separated unanswered's doc comment from unanswered; a stray blank line.
- NOTED (NIT): suspectedMisrouteCount still counts a declared agent; its comment says so.

## Review 3 (opus, blind, on fde4abb76)
- FIXED (WARNING): unanswered's doc comment still said "from the record alone"; it now reads profiles and direct
  threads. The false phrase is deleted.
- FIXED (NIT): owedElsewhere's comment miscounted what the misroute count leaves out; the sentence is deleted
  (suspectedMisrouteCount documents itself).
- FIXED (NIT): the Mac's control-character `tr` became dead after the one-line refusal; removed.
- FIXED (NIT): `kosmos reply-channel --clear Discord` stored "--clear Discord"; both commands now refuse a channel
  that starts with - (test with a control; a mutation on each side goes red).
- NO CHANGE (NIT): the screen path does not require isNamedOurs. Only the person's screen reaches it, and requiring
  it could refuse an adopted agent the person can see.
- NO CHANGE (NIT): no server test of the pane-named (from_pane) path; that path is processCaller's, shared with the
  role and task routes and tested there.

## Review 4 (sonnet, blind, on ee8379f11)
- DUPLICATE of review 2 (deferred): a pane taken as given; a declaration is permanent and the misroute count differs.
  No new BLOCKER, WARNING or CONVENTION.
- FIXED (NIT): a leading space slipped "-x" past the dash check (the board trims it); both commands check the
  trimmed text (test arm; a mutation on each side goes red).
- FIXED (NIT): replychannel.js's lazy-require comment claimed more than the code needs; reduced to what it does.
- NO CHANGE (NIT): CLAUDE.md lists neither agent CLI verbs nor single engine modules; its rule (moved files,
  changed commands, a new directory) does not call for a row.
- NO CHANGE (NIT): directRows hands back its cached rows; every caller only reads them.
- One more blind pass runs because these NIT fixes changed code.

## Review 5 (opus, blind, on 30f776d6f)
- FIXED (WARNING): no agent could learn the verb exists; both reminder texts now teach it (tests on both, and a
  mutation on each goes red; the room line keeps its guarded prefix).
- FIXED (WARNING): no server test of the pane path the Mac uses; added (a pane names its own agent, a body name is
  ignored). Writing it found test pollution: a profile set in one test outlived it; each test now starts cleared.
- FIXED (WARNING): a screen branch nothing called, and the person cannot see a declaration. The branch is removed
  (the route is agent-only); visibility is kosmos#5820.
- FIXED (CONVENTION): replychannel.js said owedElsewhere shares unanswered; it shares answeredOffRoom.
- FIXED (NIT): the direct-thread cache is keyed by the thread file's path, not the agent's name.
- FIXED (NIT): a comment line past the block's wrap; rewrapped.
- FIXED (NIT): a refused declaration on a stale token now prints the #5333 way-back hint, on both commands.

## Review 6 (sonnet, blind, on ff5d72aa1)
- FIXED (WARNING): a Kosmos row on the direct thread with no `from` counted as the person speaking again, ending the
  answer window early. Kosmos's own rows are now skipped there. Test with a control (the person speaking still ends
  it); the mutation goes red, so it was a real latent case, not only a theoretical one.
- DUPLICATE (WARNING): automatic direct-thread counting reaches every agent (Baron's design, in Decided).
- DUPLICATE (WARNING): only the agent can clear a declaration (review 2 deferral; kosmos#5820).
- FIXED (NIT): the first-reply sweep read every idle agent's profile; it now reads one only once a nudge is due.
- FIXED (NIT): the Mac's leading-space strip gets a one-line comment.
- NO CHANGE (NIT): the cache comment claims no exactness ("while the file's mtime and size stand").

## Review 7 (opus, blind, on 358b87fb9)
- FIXED (WARNING): every reminder taught the opt-out, steering an agent that simply forgot toward silencing them for
  good. Only the first-reply nudge teaches it now, saying it is never for quieting one; the room line is main's again.
- FIXED (WARNING, by removal): one direct reply cleared every room's asks for an hour (not project-scoped). The
  automatic direct-thread counting is removed (see Decided); its tests go with it.
- FIXED (NIT): the nudge's comment now says an agent that clears its channel is reminded on the next sweep.
- FIXED (NIT): "the screen sets nothing" claimed more than the code enforces; reworded (a page carries no pane).
- GONE (NIT): the "no upper bound at now" note was about the removed direct-thread code.

## Final validation 1 (full suite on b9d007592, after main merged in): RED, fixed
- The node suite was clean (18891 tests, 0 fail). The shell part failed one check: tools/test-kosmos-help-exit0-3036.sh
  pins the `--help` exit-0 case as starting `msg|reply|post|...`, and its pattern for added verbs was `[a-z]+`. Putting
  `reply-channel` between reply and post broke the pinned prefix, and the hyphen could not match anyway.
- FIXED: `reply-channel` moves to the end of that case, and the test's added-verb pattern is `[a-z][a-z-]*` (both
  regexes). The guard still goes red when a read-only verb joins the exit-0 case (mutation checked).
- Lesson: the targeted runs covered the node CLI tests but not the shell tests that read install/kosmos. All 15 of
  those (minus the install, release and queue ones) now pass alone.
