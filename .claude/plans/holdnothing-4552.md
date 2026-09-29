# holdnothing-4552: the Assigner could never give work on a real board (kosmos#4552)

## Found (April's live check, 2026-09-29)
engine/assigner.js gives work only to an agent whose commitments record reads `clear`, and nothing shipped writes
that record (only tests do). Every real agent reads `unknown` (neverReported), so the Assigner never acts. Her
positive control: writing {"commitments":[]} by hand made it give the task 20 minutes later.

## Decision (reversible)
The report route (POST /api/report) writes the empty list when an `idle` report is RECORDED, through one rule in the
store: commitments.assertIdle(agent, hasOpenWork). It writes [] only when:
- the board says the agent holds no open task part (assigner.hasOpenWork is a definite false; unreadable projects
  answer "cannot tell" and nothing is written);
- the agent's last stated list was empty or it never stated one (never over a list it named, fresh or stale: only the
  agent can drop a commitment; never over a record that exists but cannot be read).
A machine idle over a standing blocked or needs_you is refused by selfreport before this runs, so it writes nothing.
Server-side, so every runner's bridge (they all POST /api/report) gets it at once.

Rejected: dropping the Assigner's commitments gate (it exists so new work never lands on an agent holding unstated
work); a CLI verb or an instruction the agent must remember to run (the same never-fires failure, less visible);
writing from the Stop hook script (a second writer per runner; the route already sees every idle report).

Weakest premise: that a recorded idle report is a true "holding nothing" when the agent never stated a list. An agent
can stop mid-promise ("I will check back after the deploy") without stating it. The same record also feeds the
restart confirmation, which will now say such an agent holds nothing. What would change my mind: a promise lost to a
restart or an assignment because of this.

## Verified
- engine/commitments-assertidle-4552.test.js: 5 arms, each "writes nothing" arm with a control that the same agent is
  written once the reason is gone (open task part, could-not-tell, a stated list fresh and stale, an unreadable record).
- server.assigner-idle-record-4552.test.js, through the real board: before any report the record is unknown and the
  Assigner's own step gives nothing (April's shape, the control); after the agent's own idle report the record reads
  clear and the Assigner's step gives it the task; a working report, an idle with an open part, and a refused machine
  idle over blocked write nothing (each with a control).
- Mutations: removing the route's call reds 3 server tests; removing the stated-list and unreadable guards reds the
  unit arms; the open-part guard was a duplicate of the could-not-tell guard (survived), so the two were folded into
  one check whose reason names the case, pinned by the test.
- Related suites green: commitments (65), assigner (32), phonenotify-718 (14), assigner-give-3595 (6),
  clear-selfreport-2575 (10), report-readback-2709 (4), report-reply-loopback-1968 (5), reports-refresh-1676 (2),
  report-hook-auto-1453 (5).
- Not yet measured: a live board after release (April's sandbox run: an idle agent with no stated list is given the
  task about IDLE_MS after its first idle report, with no hand-written record).
