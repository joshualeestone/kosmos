# linkjob-8724: Set up and restart, for a window linked by hand (kosmos#8724 item 1)

Card: kosmos#8724 item 1 ("Restart"). Stacked on reclaim-8719 (#8719 part 2, the link), itself on unmanaged-8719
(part 1, PR #8725). Items 2 (`kosmos adopt` re-binding) and 3 (other runners) are later slices on the same card.

## Finished means
On the agent page of a window the person linked to Kosmos by hand, Restart no longer dead-ends at "was not started by
Kosmos". The dialog says the agent was started by hand, that Kosmos can set it up to start on its own and then restart
it, and that it comes back the way Kosmos starts its own agents (possibly a different account). The button becomes
"Set up and restart"; pressing it writes the agent's launch job and restarts it. Anything not plainly that case keeps
today's refusal, unchanged. Proven by engine tests (register.repair linked), route tests (offer, no offer, set up,
refuse, failed job) with perturbation controls, and a browser-check arm on the real page.

## How
- engine/remove.js: the no-job refusal in restartSteps carries `noJob: true` (the reason is the missing job).
- engine/register.js: `repair({ only, linked: true })` acts on one named agent with a profile, its folder, not removed
  and a PROVEN absent job (`job === false`), without the notice's extra conditions (has run here, not hidden): a
  hand-started window may never have written Kosmos's run record. Everything after eligibility is the existing repair
  (runner from the profile, Qwen/vendor accounts, policy hold), so the job is written exactly as Repair writes it.
- server.js: `linkedWithoutJob(name)`: the board's card is ours AND its tmux session is exactly the agent's name AND the
  survey row qualifies. POST /api/agent/:name/restart: a no-job refusal on such an agent gets `canWriteJob` and the new
  sentence; `{ writeJob: true }` re-checks, writes the job (repair linked, model as Repair reads it), then restarts.
  A failed job stops before the restart, with its reason.
- web/index.html: RST_WRITE_JOB; on a `canWriteJob` refusal the Restart button reads "Set up and restart" and its next
  press sends writeJob; a fresh open resets it. Same in the handoff-then-restart path. The link dialog's sentence
  "the board cannot restart it" now says Restart offers to set it up.

## Decided
- Session name must equal the agent's name. The supervisor targets `=<name>` (bin/agent-supervisor.sh TARGET) and
  adopts a marked live session of that name; a window linked as `zara-discord` would not be found, and the job would
  start a second Zara beside it. Those keep the old refusal. Rejected: writing the job anyway (two agents).
- The person's press is the confirmation: the offer appears only after they confirmed Restart and the engine said why
  it could not. Rejected: writing the job silently on any Restart (an unasked job that starts at every login).
- Rejected: reusing the notice path (`only` alone): it requires a run record and an unhidden notice, which a
  hand-started window may not have.

## Weakest premise
That installJob's start, with the linked session already live, adopts it rather than starting a second one. Read from
bin/agent-supervisor.sh (the `@kosmos_agent == $SESSION` and live-command branch: "already running, leaving it alone
and watching it"), not run end to end here. The card records this as not measured.

## Tests
- engine/register.linked-8724.test.js (4; perturbation of the linked branch: 3 red).
- server.restart-linkjob-8724.test.js (5; perturbation of the session-name guard: the zara-discord arm red).
- docs/browser-checks/render-restart-kloader-2831.js arm 3 (offer, relabel, writeJob body, reopen reset, control).
- Related existing: 20 files that name the refusal, restartSteps, register.repair or rst-go (611 tests, 0 fail).
