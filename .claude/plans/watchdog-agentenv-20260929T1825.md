# watchdog-agentenv: the watchdog test runs its person cases as a person (#4619)

Liu Kang m3536: file it, fix the test, add a case that keeps the guard covered, one small PR reviewed by Scorpion,
first in the queue because it unblocks every agent's gated run.

Cause (measured): #4466's agent_board_guard refuses `kosmos start`/`stop` when _invoked_by_agent
(KOSMOS_AGENT_SESSION, KOSMOS_AGENT_TOKEN, or a pane marked @kosmos_agent). tools/test-board-watchdog-2955.sh's CLI
cases 13 and 14 model a person but inherit the identity of whoever runs the suite, so every gated run from an
agent pane is red on them; CI has no identity and is green.

Change: unset the three variables before the CLI section (the stub-CLI watchdog cases above do not reach the real
CLI's guard). New case 15 sets KOSMOS_AGENT_SESSION on purpose: an agent's start is refused (exit 1) and keeps a
person's deliberate-stop marker; an agent's stop of a board that is not running exits 0 and writes no marker.

Done means: from an agent pane, main fails the two marker cases and this branch has 0 failures; with
_invoked_by_agent forced false, both new guard cases fail (measured, see the commit message).

Weakest part: unsetting TMUX_PANE covers the pane-marker arm by removing the pane, not by testing it; the new cases
exercise the guard through KOSMOS_AGENT_SESSION only. The pane arm stays covered by cli.busy-health-4466.test.js
(not re-measured here).
