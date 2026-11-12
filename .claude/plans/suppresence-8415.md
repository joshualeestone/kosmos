# kosmos#8415: a Windows supervisor records its own presence

Follow-up to #8410 (PR #8418, 9a24a938eb). `create.runningJobs('win32')` reads `win32streamstate.liveNames`, which only
knows the pid in an agent's state file. For a Claude agent that is the CHILD's pid, cleared when the child exits, so
while a Claude supervisor is up between children (restarting after a crash, or waiting on blockedBy) the agent read
"Not running" (the #668 inversion). The state-file rule also misreads a reused pid and a Fast Startup boot.

## Call
- New `engine/win32presence.js`. At start the supervisor (`win32supervisor.main`) listens on a named pipe with a random
  name (`\\.\pipe\kosmos-sup-<16 hex>`), drops every connection at once, `unref`s the server, and once it is listening
  writes `<key>.presence` in win32-state: `{v, pid, pipe}`. `handle.stop` removes the file (only if it still names
  this process) and closes the pipe.
- `liveNames`: a name whose presence record names a pipe that exists is live (a look that misses is retried once). A
  record whose pipe is gone AND whose pid is dead is NOT live, whatever its state file says (the supervisor is dead,
  so a pid in the state file is stale or someone else's). A record whose pipe looks gone while its pid is alive
  decides nothing (a look can miss a busy pipe), and neither does a missing record: then #8410's state-file rule answers.
- A starting supervisor removes any older record first, so a crashed run's record cannot make a live agent read Not
  running when the new pipe fails to open (review 1).
- Proof of life is the pipe, not the pid: Windows removes a pipe when its process dies (crash, killed tree, Fast
  Startup's logoff), and while it lives nobody else can hold the random name it made. Measured on Windows by Homer (on the
  card): existsSync reads a live pipe true in about 0.1 ms, false after close, never-created, and after taskkill /F.

## Rejected
- Process start time: Windows needs a PowerShell or WMI spawn per read (hundreds of ms per poll).
- The existing channel pipe (`kosmos-agent-<key>`): its name is predictable, so another account can hold it while the
  supervisor is down, and it is absent whenever the channel failed to open; presence should not depend on either.
- A token echoed over the pipe: an async round trip, where liveNames is read synchronously.

## Weakest premise
A supervisor that dies while its Claude child lives on: presence says not running though a child process is up. That
matches the Mac, whose launchctl pid is the supervisor's, and a supervisor-less child is not supervised anyway.

## Tests
- `engine/win32presence-8415.test.js`: liveNames with a presence record (pipe present, gone, never named), the
  precedence over a state file, the fallback with no record, a malformed record; start/stop writing and removing the
  file on a real socket (a unix socket path on Mac/Linux via the `pipePath` seam, the real pipe on Windows CI).
- Supervisor main(): starts presence for its agent with an onProblem sink, and its stop ends it (the wiring; the
  write-once-listening and remove-on-stop behaviour is covered at the module level).

## Review 2 (applied)
- The presence server's connection handler gets a no-op `error` listener (a Windows look connects, and a reset on the
  way out must not be an uncaught exception, as in win32channel). Stated gap: no test off Windows can make a reset
  reach the server socket, so removing the listener stays green on Mac/Linux (measured). It is a guard, matching the
  channel's; the Windows CI run is the only place it could be exercised.
- New test: 100 real connections (sequential and concurrent, half dropped at once by the client) leave the pipe up and
  raise nothing.
- The retry now waits 5 ms (a synchronous Atomics.wait, only after a miss) before the second look.
- Comments: the five state-file limits are lifted only when the pipe is up or the pipe and pid are both gone; the
  "nobody else can hold the name" claim is replaced by what actually protects it (random name, record in the account's
  folder, prefix check).

## Review 3 (applied)
- BLOCKER fixed: the tests' made-up pipe names now carry the real `kosmos-sup-` prefix (FAKE()), so the reader's
  Windows prefix rule cannot drop them on the Windows runner. Checked under a simulated win32 platform: prefixed names
  accepted, bare and foreign names ignored. New Windows-only test: a record naming a foreign pipe is ignored.
- The retry now happens only when the record's pid is alive (the busy-pipe case). A dead pid with a missing pipe is
  decided on one look with no pause, so a crashed run's leftover record costs one look per poll, not a 5 ms block.
- start() keeps an older record whose pipe still exists (a supervisor that is still up during a restart overlap) and
  removes only one whose pipe is gone.
- Stated limit of the stand-in: off Windows a unix socket left by a crash still exists on disk, so "the pipe vanishes
  when its holder dies" is not modelled there; the dead-supervisor cases are covered through the pipeExists seam, and
  only the Windows runner checks the real vanishing.
- Not done (decided): leftover records of removed or renamed agents are not reaped; each costs one look per poll.
