# linkjob-8724: Set up and restart, for a window linked by hand (kosmos#8724 item 1)

Card: kosmos#8724 item 1 ("Restart"). Stacked on reclaim-8719 (#8719 part 2, the link), itself on unmanaged-8719
(part 1, PR #8725). Items 2 (`kosmos adopt` re-binding) and 3 (other runners) are later slices on the same card.

## Finished means
On the agent page of a window the person linked to Kosmos by hand, Restart no longer dead-ends at "was not started by
Kosmos". The dialog says nothing is set up to start it again, that Kosmos can set it up to start on its own and then
restart it, and that it comes back the way Kosmos starts its own agents (possibly a different account). The button becomes
"Set up and restart"; pressing it writes the agent's launch job and restarts it. Anything not plainly that case keeps
today's refusal, unchanged. Proven by engine tests (register.repair linked), route tests (offer, no offer, set up,
refuse, failed job) with perturbation controls, and a browser-check arm on the real page.

## How
- engine/remove.js: the no-job refusal in restartSteps carries `noJob: true` (the reason is the missing job), and
  restart() takes `opts.beforeSteps`, run after its quiet-hours, cap and busy checks and before it acts.
- engine/register.js: `repair({ only, linked: true })` acts on one named agent with a profile, its folder, not removed
  and a PROVEN absent job (`job === false`), without the notice's extra conditions (has run here, not hidden): a
  hand-started window may never have written Kosmos's run record. Everything after eligibility is the existing repair
  (runner from the profile, Qwen/vendor accounts, policy hold), so the job is written exactly as Repair writes it.
- server.js: `linkedWithoutJob(name)`: the board's card is ours AND its tmux session is exactly the agent's name AND the
  survey row qualifies. POST /api/agent/:name/restart: a no-job refusal on such an agent gets `canWriteJob` and the new
  sentence, only for a caller that sends `offerJob` (the restart dialog; the restart line, Start, Add instructions and
  the CLI keep the engine sentence); `{ writeJob: true }` re-checks, then writes the job inside the restart
  (beforeSteps: repair linked, model as Repair reads it), so a restart refused by its quiet-hours, cap, busy or
  deleting checks leaves no job. A refusal inside restartSteps after that (a session it cannot tie) leaves the job in
  place, and the answer says it is set up. A failed job stops there, with its reason; a job written
  whose restart did not take says so.
- web/index.html: RST_WRITE_JOB; on a `canWriteJob` refusal the Restart button reads "Set up and restart" and its next
  press sends writeJob; any other refusal withdraws it (label back to Restart) and a fresh open resets it. While it is
  offered the hand-off button is hidden (it would send a plain restart). The handoff-then-restart path does not ask
  for the offer (its relabelled press would skip pointing the fresh session at its handoff).
  The link dialog's sentence "the board cannot restart it" now says restarting may first need the set-up.

## Decided
- Session name must equal the agent's name. The supervisor targets `=<name>` (bin/agent-supervisor.sh TARGET) and
  adopts a marked live session of that name; a window linked as `zara-discord` would not be found, and the job would
  start a second Zara beside it. Those keep the old refusal. Rejected: writing the job anyway (two agents).
- The offer does not say the window was started by hand: an agent Kosmos started whose job later went missing
  qualifies too, and for it the set-up is the same repair the restart notice offers.
- The person's press is the confirmation: the offer appears only after they confirmed Restart and the engine said why
  it could not. Rejected: writing the job silently on any Restart (an unasked job that starts at every login).
- Rejected: reusing the notice path (`only` alone): it requires a run record and an unhidden notice, which a
  hand-started window may not have.

- Not on Windows (a link is refused there, and a Scheduled Task's start beside a live agent is unproven), and not on a
  board in a named world (its sessions carry the world suffix, so none equals the name): both keep the plain refusal.

## Weakest premise
That installJob's start, with the linked session already live, adopts it rather than starting a second one.
supervisor.adopt-linked-8724.test.js runs the real bin/agent-supervisor.sh against a fake tmux reporting a session
marked with its own name and a Claude pane: adopted, no kill, no new-session (control: a shell pane is killed).
Measured once more on a REAL tmux (2026-11-19 09:03 CST, private socket `-L angel-rt-8724`, never the shared server):
a session `zara` marked `@kosmos_agent=zara` whose pane ran a binary named `2.1.212` (pane_current_command 2.1.212,
as a native Claude window reads). The real bin/agent-supervisor.sh said "zara is already running -- leaving it alone
and watching it"; afterwards one session, same pane pid (91928). Control on the same socket: the session holding only
`zsh` was closed and a launch attempted. Not run under launchd itself.

## Tests
- engine/register.linked-8724.test.js (4; perturbation of the linked branch: 3 red).
- server.restart-linkjob-8724.test.js (9; callers without offerJob keep the engine sentence; a refused repair; perturbation of the session-name guard: the zara-discord arm red; a gate
  refusal writes no job; a written job whose restart did not take says so).
- supervisor.adopt-linked-8724.test.js (2; the real supervisor adopts a linked Claude window; control kills a shell).
- docs/browser-checks/render-restart-kloader-2831.js arm 3 (offer, hand-off hidden, relabel, writeJob body, reopen
  reset, failed set-up withdraws the offer, plain-refusal control).
- Related existing: 20 files that name the refusal, restartSteps, register.repair or rst-go (611 tests, 0 fail).
