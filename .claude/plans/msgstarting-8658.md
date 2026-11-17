# kosmos#8658: an agent's message, and a message during a crash relaunch, get #8652's starting wait

## Finished looks like
On Windows, `kosmos msg` from one agent to an agent that was just created or restored is delivered after a short
wait, or answered "still starting, nothing was sent"; a message sent while a crashed agent is being relaunched is
waited for the same way; a name that is really missing answers exactly as before, at once.

## Change
1. server.js `POST /api/msg`: after the sender is identified and before `messages.sendAsync`, if the recipient has no
   roster card and `startingAgent(to)` (from #8652) is true, wait with `awaitRosterRow(to)` and re-read the roster;
   if the row never shows, answer `could_not` "NAME is still starting, so nothing was sent. Try again in a moment."
   Same 200/`could_not` shape the route already uses for every refusal.
2. engine/win32supervisor.js: on a RESUME (crash relaunch), re-record the agent's OWN session id, which re-stamps the
   row's time without adding a row, so `startingAgent` sees the relaunch. Best effort: a throw does not stop the run.

## Rejected
- A separate "relaunched" marker file: the record row's time already means "this session started recently", and
  re-stamping the same id cannot create the duplicate-row hazard the supervisor's comments warn about.
- Changing `kosmos msg`'s client to retry: the server knows the agent is starting, the client does not.

## Weakest premise
That re-recording the same session id is harmless: `record()` rewrites the same key under the lock, so no second
row; the prune on a fresh start keys on ids, not times, so a newer time changes nothing there.

## Tests
- server.msg-starting-8658.test.js: placed once the row appears; control with the wait off (not delivered); never
  appears (still starting, bounded); missing name and running agent unchanged and immediate. On the old server.js the
  two starting arms fail and the rest pass.
- engine/win32supervisor.test.js: a resume re-stamps its own id and adds no row; a throwing re-stamp does not stop
  the resumed run. The #570 test that resumes agent "a" now forgets the row its resume writes (it leaked into the
  next test's prune otherwise).
