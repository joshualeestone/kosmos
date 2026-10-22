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
- **HUP and PIPE exit 2.** They exited 129/141; through the queue that maps to cannot-tell, but an explicit
  KOSMOS_PROMOTE_AGENT_GATE_CMD read it as a refusal.
- **Queue log in the EXIT trap.** Measured first: bash 3.2 and 5 run the EXIT trap on TERM, INT and HUP.

## Measured
- test-staging-agent-online-check.sh: 44 arms pass (35 before, 9 new). test-staging-channel-2036.sh: ALL PASS (2 new).
- Mutants, each reverted after: no HUP/PIPE in the trap (2 red), no clear (30 red), no typed name (1), no launchctl
  enable (1, the live launchctl arm), a PARTIAL clear read as cleared (1), no queue-log trap (1).
- fixture-discipline.test.js 20/20.
- NOT measured: a real board's leftover route answering the gate. The fake models engine/delete-leftover.js and
  server.js; the next promote's gate is the first live run (#6906 stays parked until then).
