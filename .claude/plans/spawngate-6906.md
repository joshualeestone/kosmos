# spawngate-6906 (kosmos): the promote's agent-spawn gate runs on the boards releases are promoted from

Card: kosmos#6906 (filed by Baron 10-22 after the 0.7.63 promote; assigned by Splinter 10:59).

## Why
The gate (tools/staging-agent-online-check.sh) never ran at a prod promote: it refused any board with more than 2 agents
(exit 2), and Mortals, which promotes run on, is a fleet board. Its stated reason, "no clean HTTP delete-agent route",
is out of date: `DELETE /api/agent/<name>/removal` is the board's own Remove agent. Every promote was therefore
`--force` on a hand check (0.7.61, 0.7.63).

## The change
- The populated-board refusal is gone. The gate still fails closed when it cannot count the board's agents.
- Every agent it creates is removed when it ends (EXIT trap; INT/TERM clean up and exit 2), and it says whether each is
  gone from /api/status. A removal that fails is said with the name to remove by hand; the verdict stands.
- After an agent is online (two consecutive polls, unchanged), it is sent one message, and the arm passes only when an
  entry `from` its session name appears in its thread (`GET /api/agent/<name>/thread`: `{messages:[{at,text,from}]}`;
  the person's message has from null). No answer within KOSMOS_AGENT_REPLY_TIMEOUT (180 s) is cannot-tell (2,
  forceable), never a refusal: a slow model or a spent quota must not block a good build unforceably.
- Names are `verify2129-<claude|openai>-<epoch>`, at most 28 characters. Found by running it for real: the board refuses
  a name over 32 ("keep it to 32 characters or fewer"), and the old `verify2129-<provider>-<epoch>-<pid>` was 31 to 37,
  so on Mortals every create came back 400 and the gate read cannot-tell. The test's fake board now enforces 32.
- docs/staging-channel.md and promote-channel.sh say what the gate now does.

## Measured
- Mortals' board, 0.7.63, 8 agents, 2026-10-22 ~11:10 CDT: the new gate PASSED (exit 0). A Claude and an OpenAI agent each
  came online, answered "ready", and were removed and gone from /api/status (aoc-6906-mortals.out).
- The same run with the old names: both creates refused (400, 32 characters), exit 2.
- tools/test-staging-agent-online-check.sh: 24 arms pass. Against main's gate: 18 fail (agents left on the board, no
  removal). With first_reply forced to succeed: the no-answer, other-sender and refused-message arms fail. With the old
  long names: 16 fail. tools/test-staging-channel-2036.sh passes.

## Decided
- No answer is cannot-tell (2), not 1. Rejected: 1, because a thread that cannot be read or a rate-limited provider would
  block a good build with an exit --force cannot clear.
- Removal runs whatever the verdict, and a failed removal does not change it: the verdict is about the build, the
  removal about tidiness.
- KOSMOS_STAGING_VERIFY_ALLOW_LIVE and KOSMOS_AGENT_ONLINE_MAX_EXISTING no longer do anything.

## Weakest premise
That two agents created and removed on a working fleet board for about a minute disturb nobody. Each gets a home folder
that the removal leaves on disk (verify2129-*), and creating an agent re-runs the board's setup steps for it.
