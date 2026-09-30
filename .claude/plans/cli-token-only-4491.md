# #4491 slice 7: the CLIs can send the agent's own token alone (a switch, off by default)

Card: joshualeestone/kosmos#4491 (claimed:angel). Branch cli-token-only-4491, stacked on agent-projects-4491
@ f386a9103 (#4740), which is stacked on agent-writes-4491 (slice 5a). It needs 5a: without it, `kosmos task add`
and `task close` would be refused on a token alone.
Addresses #4491 (the card stays open: turning the switch on for an agent is the next step).

## What finished looks like
With `KOSMOS_AGENT_TOKEN_ONLY=1` and a well-formed agent token, every agent verb whose route answers to the token
alone sends ONLY that token and does not read the board token, on the Mac and on Windows. The person's verbs keep
the board token whatever the switch says. With the switch unset (the default) nothing changes for anyone.

## The change
- install/kosmos: `agent_board_token`, beside `board_token`. It prints nothing when the switch is exactly `1` and
  the token is plain lower-case hex (spelled out, not as a range; see review 1); else it is `board_token`. Eleven
  verb functions use it:
  msg, reply, post, whoami, report, report show, react, room (the read; reopen keeps its own `board_token`), task,
  agent (roles, role-draft, create through /api/team), project (list and show; create reads `board_token` itself).
- tools/windows/kosmos-cli.js: `headersFor` skips reading the board token under the same rule; `person: true` on
  project create, community post and community read. (Room reopen, connections and connect already send no agent
  token, so they keep the board token by the same rule.)
- Tests: cli.agent-token-verbs-4491.test.js (Mac) gains the token-only cases; a new
  tools.windows-kosmos-cli-token-only-4491.test.js (Windows).

## Decisions (mine, each reversible)
1. A switch, off by default, read from the environment. Nothing sets it yet. Rejected: flipping every agent at once
   (my recommendation on the card was one agent first) and a board setting (a later slice can have the supervisor
   put the variable into one agent's launch from a setting; the CLI side does not change for that).
2. NO fallback to the board token when the board refuses the token alone. A fallback would put the person's
   credential back into exactly the requests the switch exists to keep it out of, and would hide a board that is
   too old to take the token. The agent sees the board's own refusal.
3. Exactly `1`, nothing else (`true`, `yes`, ` 1` all leave it off). A typo leaves an agent working as today,
   which is the safe side.
4. Community read stays on the board token here: its route joins the set in slice 6 (branch community-read-4491),
   which is not under this branch. When both are on main, it is one line in each CLI.
WEAKEST PREMISE: that the verb-to-route list is right. It was read from both CLIs at f386a9103 and each route checked
against server.js's sets (AGENT_TOKEN_ROUTES and patterns, REMOTE_AGENT_ROUTES for report and reply,
LOOPBACK_AGENT_ROUTES for the team route and the report read). A verb that sends the token alone to a route that
needs the board token fails loudly with the board's refusal, never silently; nothing here was run against a real
enforcing board.

## What an agent with the switch on can no longer do
- read the room or the task list of a project it is not on (the two reads narrowed for a caller that came on its
  token alone, agentTokenOnlyCaller).
(My first version also listed "add or close tasks in a project it is not on". That was wrong: since slice 5a the
board identifies the caller from the agent token whether or not the board token is also sent, so that refusal
already applies with the switch off. Review 1 found it.)

## Measured
- Mac: cli.agent-token-verbs-4491.test.js 63 of 63 after review 1 (53 before) (every agent verb: switch off sends both, on sends the agent's
  alone; a junk or absent token or a switch other than `1` keeps the board token; three person verbs keep it).
- Windows: the new file 40 of 40 after review 1 (30 before), including that the board token is not READ at all in token-only mode.
- Neighbours: 80 of 80 across eight CLI test files; 52 of 52 across the four that read the CLI's board_token text.
- Mutations, each red then restored byte-identical: Mac, msg left on board_token (1 red); project create sending
  the agent verb's token (1 red); the switch ignoring the token check (13 red). Windows, `person` ignored (3 red);
  the switch check removed (26 red).

## Review round 1 (one blind reviewer, no blocker; four should-fix and two nits, all taken)
1. An agent that runs the tests with the switch on in its own environment turned five tests in OTHER files red
   (they spread process.env and expect the board token). Fixed at the boundary, as the runner already does for the
   Codex home: tools/run-tests.sh unsets the switch before the node suite; tools/test-run-tests-codexhome-2858.sh
   now guards that line (removing it turns the guard red). A focused `node --test` run by hand with the switch on
   is NOT protected.
2. Verbs switched but untested: task built, report show, project list and show, agent create (Mac); task built,
   report show, project show, role-draft, agent create (Windows). All added. Agent create makes no request without
   a usable token, so it runs only the switch cases.
3. The plan claimed an off-project task add or close as new; it is not (above).
4. Automatic status reports do not honour the switch. See Not done.
5. `[!0-9a-f]` in bash can let upper-case A to E through in a dictionary-ordered locale (measured by the reviewer
   with macOS bash 3.2 under en_US.UTF-8). The new helper spells the class out. With the range put back, the new
   ABCDE case turns 17 tests red under en_US.UTF-8. The OLDER per-verb checks that decide whether to present the
   agent token keep their ranges: not this slice's change, and a token they wrongly present is refused by the board.
6. "Ten verbs" was eleven.

## Review round 2 (a second blind reviewer, no blocker; one should-fix, one nit, both taken)
1. The ABCDE case could only fail when the tests happened to run in a dictionary-ordered locale (under C it passed
   with the range put back). That one send now runs with LC_ALL=en_US.UTF-8, and with the range put back the suite
   run under LC_ALL=C turns 17 red.
2. The runner guard only compared line numbers. It now also runs the runner's own unset line and checks that a
   node child no longer sees the switch.

## Not done
- Automatic status reports ignore the switch: the Mac report hook goes through `kosmos report` and so honours it,
  but the Windows Claude hook (engine/kosmos-report-hook.js) and the Codex, Gemini, Grok and Antigravity bridges
  read and send the board token regardless. An agent on those, with the switch on, still reads the person's
  credential on every report. The CLI side is complete; that side is the next slice.
- No review yet, no full run (the top of the stack validates the stack, #4749 E).
- Nothing sets the switch. No agent runs with it.
- Not run against a real enforcing board.
