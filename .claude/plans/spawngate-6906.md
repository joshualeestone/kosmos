# spawngate-6906 (kosmos): the promote's agent-spawn gate runs on the boards releases are promoted from

Card: kosmos#6906 (filed by Baron 10-22 after the 0.7.63 promote; assigned by Splinter 10:59).

## Why
The gate (tools/staging-agent-online-check.sh) never ran at a prod promote: it refused any board with more than 2 agents
(exit 2), and Mortals, which promotes run on, is a fleet board. Its stated reason, "no clean HTTP delete-agent route",
is out of date: `DELETE /api/agent/<name>/removal` is the board's own Remove agent. Every promote was therefore
`--force` on a hand check (0.7.61, 0.7.63).

## The change
- The populated-board refusal is gone. The gate still fails closed when it cannot count the board's agents.
- Every agent it creates is removed when it ends (EXIT trap; INT/TERM clean up and exit 2; cleanup ignores further
  signals), and it says whether each is gone from /api/status. A removal that fails is said with the name to remove by
  hand; the verdict stands. A create whose answer never came (lost, timed out, interrupted) is removed only if the board
  lists it; one that answered 200 is removed whatever the list says; one refused (400) is not this run's to remove.
- Creates send `notifyCreated:false`, so gate agents never raise the public agents-created count.
- After each removal the gate DELETES that agent's launchd job file and worker folder. The board's Remove agent deletes
  nothing on disk (engine/remove.js: removal is reversible), and on 2026-10-22 the job files my manual runs left on
  Mortals, made while Pete's full validations ran, redded their #3011 LaunchAgents guard. The paths come from the
  board's own engine (create.js now exports plistPath; workerDir was already exported), only a `verify2129-` name of
  the gate's own form is touched, and each path's last part must be that name. An older board without the export gets
  a warning naming the files, and nothing is guessed.
- promote-channel.sh runs the gate through tools/queued-heavy.sh by default (KOSMOS_PROMOTE_AGENT_QUEUE overrides it),
  so it never starts beside a suite. The verdict is taken only from the queue's "QUEUED-HEAVY ... END rc=<n>" line: the
  queue exits 2, 3, 4 and 75 for its own reasons before the gate runs, so no END line (or rc 75, a stopped turn) is
  cannot-tell, never PARTIAL and never a refusal (review 3 BLOCKER). test-staging-channel-2036.sh drives this with
  stub queues. An explicit KOSMOS_PROMOTE_AGENT_GATE_CMD runs as given, unqueued.
- After deleting a job file, the gate re-enables its launchd label (`launchctl enable`), since removal disabled it;
  never in a sandboxed run (AGENT_WORKFORCE_LAUNCH set). It says "found no job file or worker folder" when there was
  nothing to delete. A lost create is looked for for a minute (6 times, 10 s apart); if the board never lists it, its
  files are left alone and the gate says where to check (deleting files under a live agent is worse than leaving them).
- Files are deleted only after a FULL removal: the board answers 200 for a partial one too, so the gate reads the
  body's `outcome` and, unless it is `removed` and /api/status no longer lists the agent, says what to do by hand
  and deletes nothing (review 5).
- A `rate_limited` agent at the end of the window is cannot-tell (2), like a usage-limit question; the limit wording
  matched is the board's own ("usage limit", "rate limit", "out of usage", "quota ran out"), so a first-run prompt
  that happens to contain "generate" or "unlimited" stays a refusal (review 5).
- When the promote itself runs inside a turn that already holds the machine, the queue runs the gate directly and
  prints no END line, so its exit code is the gate's ("runs now, inside the turn" in the log) (review 5).
- A 200 create is confirmed at once (before the name is parsed), and a board that answers with another name is
  cannot-tell, with only the name the gate asked for removed (review 2).
- After an agent is online (two consecutive polls, unchanged), it is sent one message, and the arm passes only on a
  STORED reply: an entry `from` its session name with no `kind`, dated at or after the send (5 s of slack). The thread
  (`GET /api/agent/<name>/thread`, `{messages:[{at,text,from}]}`) also carries a `kind:"question"` row from the agent
  while it waits on a prompt (engine/chat.js withQuestionRow), which must never read as an answer (review 1).
- An agent still waiting on a usage or rate limit when the online window ends (its `because` names a limit, quota,
  credit or rate) is cannot-tell (2): the account, not the build. Any other first-run question stays a refusal (1),
  since a build that brings in a new first-run prompt is the #2129 class (reviews 1 and 3). No answer within KOSMOS_AGENT_REPLY_TIMEOUT (180 s) is cannot-tell (2,
  forceable), never a refusal: a slow model or a spent quota must not block a good build unforceably.
- Names are `verify2129-<claude|openai>-<epoch>-<pid mod 1000>`, at most 32 characters, unique per run. Found by running it for real: the board refuses
  a name over 32 ("keep it to 32 characters or fewer"), and the old `verify2129-<provider>-<epoch>-<pid>` was 31 to 37,
  so on Mortals every create came back 400 and the gate read cannot-tell. The test's fake board now enforces 32.
- docs/staging-channel.md and promote-channel.sh say what the gate now does.

## Measured
- Mortals' board, 0.7.63, 8 agents, 2026-10-22 ~11:10 CDT: the new gate PASSED (exit 0). A Claude and an OpenAI agent each
  came online, answered "ready", and were removed and gone from /api/status (aoc-6906-mortals.out).
- The same run with the old names: both creates refused (400, 32 characters), exit 2.
- After review 1, Mortals again: PASS, both answered "ready", both removed (aoc-6906-mortals2.out).
- After review 2, the exact default command promote-channel now builds (queued-heavy.sh agent-spawn-gate bash
  staging-agent-online-check.sh 16180), run on Mortals from this branch at be1fa9cec1: it waited 35 minutes (11:46:20 to 12:21:44) in
  the queue (two suites ran in turn; a suite may start while it waits, since suites can run side by side), then PASS,
  both answered "ready", each one's job file and worker folder deleted and the agent removed; QUEUED-HEAVY END rc=0;
  afterwards 0 verify2129 plists in ~/Library/LaunchAgents and 0 worker folders (aoc-6906-queue.out).
- tools/test-staging-agent-online-check.sh: 34 arms pass at the last count; mutants dropping the kind filter, the date filter, or
  notifyCreated each turn arms red. Earlier: 24 arms Against main's gate: 18 fail (agents left on the board, no
  removal). With first_reply forced to succeed: the no-answer, other-sender and refused-message arms fail. With the old
  long names: 16 fail. tools/test-staging-channel-2036.sh passes.

## Decided
- No answer is cannot-tell (2), not 1. Rejected: 1, because a thread that cannot be read or a rate-limited provider would
  block a good build with an exit --force cannot clear.
- Removal runs whatever the verdict, and a failed removal does not change it: the verdict is about the build, the
  removal about tidiness.
- KOSMOS_STAGING_VERIFY_ALLOW_LIVE and KOSMOS_AGENT_ONLINE_MAX_EXISTING no longer do anything.

## Not done here (follow-up)
- The board keeps a Removed-list row for each removed agent and has no way to forget one, so every promote adds two
  `verify2129-*` rows whose Restore cannot work. Filed as a follow-up card (a forget route the gate would call).
- A gate agent is made like any agent, so on a board with the Community switch on its instructions carry the community
  block and may ask it to introduce itself. Its first message says to do nothing but reply, and it is removed within
  about a minute; there is no create-time way to leave the block out. Filed as a follow-up card.

## Known cost
At a promote the gate may now wait for the machine's suites to finish: up to the queue's bound (6300 s), and a suite
can start while it waits. Bounded, and the price of never redding someone's validation.

## Weakest premise
That two agents created and removed on a working fleet board for about a minute disturb nobody. Their files are
deleted, but their profile, direct thread and Removed-list rows stay, and creating an agent re-runs the board's setup
steps for it. Second: that the gate's process computes the same paths as the board (both use the same user and,
at a promote, no KOSMOS_WORLD).
