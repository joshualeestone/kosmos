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
- engine/remove.js: `waitUnloaded(label)`, used in restartInner between stopNow and startNow (Mac ops only). It polls `launchctl print` every 100 ms until the job is gone, for at most 15 s, then bootstraps. If the job is still held when the wait runs out, it bootstraps anyway and the loaded check decides as before.
- The budget is AGENT_WORKFORCE_UNLOAD_WAIT_MS (test seam). With an injected runner (scripted tests) it defaults to 0: no wait and no look, so their exact call lists stay as they are. The #4964 tests set it explicitly.

## Decisions
- Wait for the unload, not retry on code 5 or tighten `loaded()`. Waiting is the condition itself. A stricter `loaded()` (refusing "SIGTERMed") would only turn the false success into a PARTIAL, and the agent would still not come back.
- Rejected: kickstart. It keeps the old ProgramArguments, so a switched provider would never take effect (the existing comment).
- Weakest premise / cost: restart is synchronous, so the board waits too, about 5 s per restart (measured 5.1 s live). A burst of class-1 auto-restarts waits once each. Accepted, because the alternative is an agent with no job. The bound is 15 s.

## Validation
- engine/remove.test.js #4964 runs against a launchd modelled on the measured timing:
  - with the wait, RESTARTED and the job loaded afterwards;
  - CONTROL without the wait, RESTARTED while the job is gone (the measured lie);
  - a job that never unloads is bounded and still bootstrapped.
- Focused run: remove/restart/class1/create suites plus the file-scanning guards, 618 pass.
- LIVE on Agent1s: the branch's remove.restart against the real launchd for zz-test-4964 took 5115 ms, and the job was `state = running` for the 10 s after (the installed build left it unloaded twice).
