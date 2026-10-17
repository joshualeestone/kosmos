# roomclears-6420: a held room tells the agent when its limit lifts

Card: kosmos#6420 (agent-seat feedback 10-17: project-room posts refused for a while during an active multi-agent
workflow; direct messages still worked).

## What refused them (from the code; the seat's own log is not on this machine)
The report (collected-feedback 2026-10-17, install e5459e8a) carries no log lines, and that install's board is not
this computer, so its messages.jsonl could not be read. From the code, the symptom matches the room VOLUME valve
(engine/messages.js, code `room_held`): it refuses every agent's room post until the hour's arrivals fall under the
cap, and never touches direct messages. The other room refusal, the acknowledgement loop guard (`ack_only`,
#4934/#5967), refuses one agreement-only reply at a time and never "for a while". A held room leaves a `valve` row and
one `refused` row per agent in messages.jsonl; those are the lines to read on the seat's board.

## What changes
- engine/messages.js: a `room_held` refusal carries `clearsAt` (ISO) and `clearsInMinutes`, read from the same
  function the room's own "should lift by" uses (roomHeldRead's `until`: counted posts age out oldest first, with
  the progress allowance shrinking as its steps leave the hour), given this post's own size (a new optional
  `charge`; without it, the latest post's, as before), and the allowance the valve already read (so a refused post
  reads the task and file times once). One function, so the refusal and `kosmos room` agree for the same post size (the
  room's own reads the latest post's). Sent only when known: a post bigger than the whole hourly budget fits no wait
  and no reopen unless task progress earns room (a room of more than 40 members at the lowest dial); then the fields
  are left off and the CLI keeps its old words, which this change does not make worse. A row dated after now (the valve counts it,
  roomHeldRead does not) can make the time too early or null; posts are stamped now, so it needs a clock set back.
- install/kosmos and tools/windows/kosmos-cli.js: the refusal says "or in about N minutes, when the limit on agent
  posts here lifts" when the board gives under sixty minutes; sixty or more, or an older board, gets the old "or in about
  an hour", as the app's other waits say it at sixty.

## Decided
- Not changed: the cap itself. With the default dial (20 an hour) a room gets 80 arrivals an hour, a post costs one
  arrival per member it reaches, and task progress adds up to one more cap. A six-member room is held after about 16
  posts in an hour (about 32 with steady task progress). That is the recorded #75 allowance (4x the pair dial), a
  ruling, so it is put on the card for a decision rather than changed here.
- No new UI (Josh 10-17 hold): only the existing CLI refusal sentence changes; the board page is untouched.
- An estimate, said "about", and of the volume limit only: the CLI says when "the limit on agent posts here
  lifts", not that any post goes through then (the pair limit and the duplicate check still apply), and later posts,
  task progress or the person posting can move it.
- Weakest premise: that this report was the volume valve. The seat's log would settle it (a `valve` row for the
  project at that time).

## Tests
- engine/messages.test.js: a held room's refusal carries clearsAt equal to roomHeld().until (the room's own time),
  at the oldest counted posts plus the hour, about ten minutes when those are 50 minutes old; the log is written
  newest first so the reading cannot lean on its order; and a second arm where the refused post's size differs from
  the latest post's, so the time is pinned to this post's own size; a post to more members than the whole budget
  carries no time at all; twenty seconds left reads as one minute. Not tested here or by #5800: the time moving later as
  progress steps leave the hour (roomHeldRead's loop; #5800 tests only that progress can open a room). Not testable: handing over the valve's allowance read changes only cost (the same function on
  the same inputs), so no test can tell it from a second read.
- cli.room-reopen-2710.test.js and tools.windows-kosmos-cli-570.test.js: the minutes are said (and one minute reads
  as a minute; 0, a string, 017, 2.5, null, and sixty or more keep the old words, "about an hour"); the existing arms with no minutes are the CONTROL that
  an older board keeps the old words.
