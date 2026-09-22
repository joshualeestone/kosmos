# Why Nora would not come back online, and the actual fix

Written by Alexandra, 2026-09-22, for whoever builds Kosmos, after Josh asked
me to look behind the scenes at why restarting Kosmos was not bringing Nora
back, ahead of a "Restart Agent" button already in progress.

## Short version

Nora is back online now, I fixed the immediate symptom manually. The
underlying bug is real and will also affect the "Restart Agent" button you
are building, unless it is fixed at the source.

## What actually happened

1. On first launch, Nora hit Claude Code's own folder-trust prompt, like every
   new agent does. Kosmos's own class-1 auto-handler (`engine/class1-autohandle.js`)
   caught this, wrote the folder-trust key, and called `restart()`
   (`engine/remove.js`, `restartInner`) to relaunch her invisibly. Logged in
   `logs/board.log`: "Nora (nora) handled (trust+restart) - wrote the
   folder-trust key and restarted the agent."
2. That log line only appears when `restartInner` returns
   `outcome: RESTARTED`. Reading `restartInner` (`engine/remove.js`, roughly
   lines 1762-1881), it closes the old session, then does:
   ```
   step('asked it to start again now', () => {
     ops.stopNow(clean, job);
     return ops.startNow(clean, job);
   });
   return { outcome: OUTCOME.RESTARTED, steps, because: ... };
   ```
   **The return value of that step is never checked.** `RESTARTED` is
   returned unconditionally as long as the OLD session was closed
   successfully, regardless of whether `ops.startNow` (the actual relaunch,
   which bootstraps the launchd job) succeeded.
3. In Nora's case, closing the old session worked, but the relaunch did not
   actually reload her launchd job. Confirmed directly: her plist,
   `~/Library/LaunchAgents/com.kosmos.agent.nora.plist`, was present and
   well-formed (diffed it against Theo's, who was running fine, no
   difference), but `launchctl list | grep nora` showed nothing, while every
   currently-running agent showed up with a live PID. The job was registered
   on disk but never loaded.
4. Because the class-1 sweep only escalates when it sees the SAME agent
   standing on a class-1 wait again on a later sweep, and a fully-vanished
   session produces no roster card at all (nothing to sweep), nothing ever
   escalated. Nora simply disappeared, silently, with no error, no
   `needs_you`, no `blocked`, nothing on the board. That is exactly why
   restarting all of Kosmos did not help either: Kosmos itself does not
   detect that a job it believes it already "restarted" was never actually
   reloaded.

## The actual fix I applied (temporary, manual)

Ran `launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/com.kosmos.agent.nora.plist`
directly. It succeeded immediately, no error, and Nora's session came up
within seconds, confirmed in both raw tmux and `kosmos agents`/`kosmos adopt`.
This confirms the job definition itself was always fine; it just was not
loaded. This was a one-off manual fix for Nora specifically, not a code
change, someone still needs to fix the underlying bug below.

## What needs to change in the code

`restartInner`'s final return should be conditioned on the actual outcome of
the `ops.startNow` step, not just on whether the old session closed. If the
relaunch step fails or its result is unclear, it should report `PARTIAL` or a
new failure outcome, not `RESTARTED`, so:
- the class-1 auto-handler does not log a false "handled" and stop trying,
- and the upcoming "Restart Agent" button does not tell a person an agent is
  back when it is not, the same trap Josh just hit.

Ideally the restart path also verifies the new session actually exists a few
seconds after asking launchd to start it (the way I confirmed it manually via
`launchctl list` and `tmux list-sessions`), rather than trusting the OS call
to have worked.

## Worth knowing separately

While checking this I noticed roughly half of the other agent plists on this
machine are also not currently loaded in launchctl (ben-okafor, cliff,
darius-cole, don, ethan-clarke, grace-kim, jim, kim, lucy-park, mike,
nadia-brooks, rob, sarah, tammy, tessa-morgan, test, test10, testagent1, tom).
Most of these look like older or intentionally-stopped agents, and Don's case
specifically DID escalate correctly in the log (five class-1 escalations,
left red, likely a real unresolved config divergence someone should still
look at separately). I did not touch any of these, flagging only that they
exist in case it is useful context, not claiming they are all bugs.
