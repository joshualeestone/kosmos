# gatefollow-6922 (kosmos): the #6906 gate follow-ups

Card: kosmos#6922 (filed by Baron 10-22 from #6906's last review round), plus the #6915 closing note.

## Why
#6906 (merged as #6926) made the promote's agent-spawn gate run on populated boards. Its review was capped at 8 rounds;
the remaining warnings were filed here. #6915 then found the board already has the verb the gate's own file deletion was
standing in for: `DELETE /api/agent/<name>/leftover` (#514).

## Decided
- **Clear with the board's delete-leftover, not by hand.** The route moves the job file and worker folder to the Trash,
  drops the Removed-list row, revokes tokens and resets the name's community standing, and frees the name. The gate's
  own `rm` did the first and left a permanent Removed row with a Restore that cannot work, two per promote.
  Rejected: keep the gate's rm and add a forget route (#6915 built one and dropped it: forgetting frees the name
  without the cleanup).
- **Send the name as the typed confirmation.** The route asks for it only when the Trash cannot take the files (then
  they are deleted for good). These are the gate's own throwaway agents, holding one "ready" reply; the old code
  rm -rf'd them anyway. Weakest premise: that nothing a person values is ever in a `verify2129-*` folder. The name
  guard (only `verify2129-<claude|openai>-<digits>`) is what holds that.
- **Keep the gate's `launchctl enable`.** Removal disables the label; the route boots it out but does not re-enable.
  create.js re-enables on create, so a reused name would be fine, but gate names are never reused, so the override
  would otherwise sit in launchd's database forever. Only outside a sandboxed run.
- **If the board cannot clear an agent, the gate deletes its files itself** (review 1). The route can refuse where the
  old rm never could (tmux unreadable, a Trash move refused, a transport blip), and a job file left in LaunchAgents is
  the #3011 red #6906 fixed. A lost answer (no code, 000) is tried again first (a repeat finds "nothing of" it). A
  PARTIAL whose files are already gone (tokens or the community account stuck) names what is left, not the files.
- **A board's PLAN refusal is never overridden** (reviews 2 and 3): a 400 with no `steps` is plan()'s judgement, and some
  are safety ones the gate cannot see (the session still running, tmux unreadable, an account move), so the files are
  left and said. The gate deletes files itself only on: no answer, 404 (a board without the route), 5xx, a PARTIAL, or
  a 400 carrying `steps` (del() adds them only once its plan passed and an act failed: every move, or the community
  standing reset). Any other answer (401, 409, a 200 it cannot read) is a refusal too. Rejected: deleting on every
  non-deleted answer (round 1, could delete under a live session) and leaving every 400 (round 2, a failed move would
  leave the job file in LaunchAgents every promote).
- **The typed words are the board's** (`typeToConfirm` from its plan), the session name only when the plan gave none.
- **A lost answer is tried once more**, and "nothing of" it on that retry counts as cleared (the first DELETE landed).
  Once only: this runs in cleanup, where a second Ctrl-C is ignored.
- **The label re-enabled is the board's** (`GET .../leftover` plan, `job.label`, launchd jobs only), not one derived in
  the gate's environment, so a board under another world cannot make it enable a stranger (review 1).
- **Accepted cost:** each promote leaves 4 items (2 job files, 2 folders) in the board user's Trash, never emptied by
  Kosmos. Harmless to #3011 (it reads LaunchAgents only); a person can empty it.
- **"Cleared" needs an empty disk on both sides** (review 5): a "nothing of" answer while this machine's engine still
  finds the files means the board looks elsewhere, so they are deleted here; and no answer, 404 or 5xx with nothing at
  this machine's paths is a warning to check LaunchAgents, never "its files are gone" (said only for a PARTIAL).
- **A plan refusal is asked once more after 3 s** (review 4): "is running" while the pane closes, and "could not check
  ... right now", can pass in a moment, and leaving the job file on one tmux read would be the #3011 red again.
- **Gate agents are created with `community:false`** (#6908, merged as #6939 while this was in review): no community
  account, so nothing for the clear to retire.
- **HUP and PIPE exit 2.** They exited 129/141; through the queue that maps to cannot-tell, but an explicit
  KOSMOS_PROMOTE_AGENT_GATE_CMD read it as a refusal.
- **Queue log in the EXIT trap.** Measured first: bash 3.2 and 5 run the EXIT trap on TERM, INT and HUP.

## Measured
- test-staging-agent-online-check.sh: 62 arms pass (35 before). test-staging-channel-2036.sh: ALL PASS (2 new).
- Mortals full suite at df19f29da: node 23328, 0 fail; the shell shard stopped at 10/284 on the #6710 sleep-control
  guard (the waiting stub queue's `exec sleep 30` had no opt-out marker). Fixed; the guard passes alone.
- Mutants, each reverted after: no HUP/PIPE in the trap (2 red), no clear (30 red), no typed name (1), no launchctl
  enable (1, the live launchctl arm), a PARTIAL clear read as cleared (1), no queue-log trap (1).
- fixture-discipline.test.js 20/20.
- NOT measured: a real board's leftover route answering the gate. The fake models engine/delete-leftover.js and
  server.js; the next promote's gate is the first live run (#6906 stays parked until then).
