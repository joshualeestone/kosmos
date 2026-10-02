# unloadwait-4964: a restart waits for launchd to let go of the old job before starting the new one

Card: kosmos#4964 (Josh, Mortals 0.7.16). After "Switch & Restart to Gemini", the agent answered in its terminal but could not be messaged from the page ("We cannot tell where this agent is running"). A manual Restart fixed it.

## Measured (Agent1s 0.7.16, throwaway agent zz-test-4964)
- I switched it to Gemini through POST /api/agent/<name>/provider, the button's route. The route answered "confirmed its job is loaded". A minute later launchd held NO job for it, and there was no tmux session.
- Bootstrapping it by hand brought the agy pane up, and the card got its target at once.
- Switching back to Claude did the same thing. Polling `launchctl print` every 0.5 s showed why:
  - bootout returned at once;
  - the job sat in `state = SIGTERMed` for 4.5 s;
  - then it was gone.
- The restart bootstraps straight after bootout, inside that gap:
  - launchd answers 5 ("already loaded"), which `startNow` treats as success;
  - `loaded()` (`launchctl print`) still answers for the dying job, so "confirmed";
  - the #4006 second try never runs.
- Then the old job finishes unloading and nothing brings the agent back. On Mortals a pane was still running unsupervised, and the board could not tie it to a job.

## Done looks like
After a provider switch (or any restart), the agent's launchd job is loaded and stays loaded, and its card has a pane target.

## Change
- engine/remove.js: `waitUnloaded(label)`, used in restartInner between stopNow and startNow, and again before the #4006 second try (Mac ops only). It polls `launchctl print` every 100 ms (2 s timeout per print) until launchd says "no such service" (113, `Could not find service`, measured), for at most 25 s (above launchd's default ExitTimeOut of 20 s). Any other print failure is not read as gone.
- Still held when the wait ends: it bootstraps anyway, but only a bootstrap that answered 0 counts as a new job. An "already loaded" (the dying job) or no bootstrap at all (a launch file that is gone) is not confirmed by print, so the second try runs and the restart ends PARTIAL, on the failed card, never RESTARTED with no job.
- Burst allowance: at most 30 s of unload waiting per 60 s, because restart is synchronous inside routes and the class-1 sweep restarts several agents in one tick. Past it, a restart does not wait and (by the rule above) ends PARTIAL.
- No wait on a board whose commands are not real (dry run, live execution not allowed: the browser-check boards), or under an injected runner unless the test sets AGENT_WORKFORCE_UNLOAD_WAIT_MS. AGENT_WORKFORCE_UNLOAD_BURST_MS is a test seam too.

## Decisions
- Wait for the unload, not retry on code 5 or tighten `loaded()` alone. Waiting is the condition itself.
- Rejected: kickstart. It keeps the old ProgramArguments, so a switched provider would never take effect (the existing comment).
- Weakest premise / cost: restart is synchronous, so the board waits too, about 5 s per restart (measured 5.1 s live), and up to 25 s for a job slow to stop. The burst allowance bounds a sweep at 30 s a minute; agents past it are left stopped on the failed card (before: stopped under a false RESTARTED).

## Validation
- engine/remove.test.js #4964 runs against a launchd modelled on the measured timing:
  - with the wait, RESTARTED and the job loaded afterwards;
  - CONTROL without the wait, RESTARTED while the job is gone (the measured lie);
  - a job that never unloads is bounded and still bootstrapped.
- Review rounds 1 and 2: dry-run freeze, trusted already-loaded after a timed-out wait, burst freeze, print failure read as gone, gone launch file; each fix has a test that fails with the fix removed (measured).
- Focused run: remove/restart/class1/create suites plus the file-scanning guards, 618 pass (before review 1; re-run before the PR).
- LIVE on Agent1s: the branch's remove.restart against the real launchd for zz-test-4964 took 5115 ms, and the job was `state = running` for the 10 s after (the installed build left it unloaded twice).
