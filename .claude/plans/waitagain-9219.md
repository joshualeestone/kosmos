# waitagain-9219 (kosmos#9219, follow-up to #9011)

**Problem.** A feedback report (2026-11-27): a held needs_you is dropped on every agent restart, and the agent has to set the wait again by hand.

On a restart the board retires the previous session's wait by Josh's ruling #5943 ("retire the needs_you its PREVIOUS session reported, or ask the new session to confirm it"). The new session is reminded, but the reminder carries only the state and the time, never the words. That is on purpose, so nothing typed into a startup reads as an instruction. So to confirm, the agent had to retype the wait.

**Change.** `kosmos report <needs_you|blocked> --again`, in both CLIs, sends `again: true`. `/api/report` finds the agent's own last wait by the reminder's rule (`awaydigest.lastWaitRow`, which `lastWait` now delegates to), over `selfreport.history(..., { fields: true })`. It re-records that wait with its stored words, `on`, `owner`, `until`, `project` and `held`.

Refused, with a sentence:
- there is no such wait;
- the state does not match;
- it is sent with words, options, `--held`, `--auto` or `clear` (400).

The reminder now names the one command.

**Rejected.** Keeping the wait across a restart on its own: that reverses #5943. Putting the wait's words in the reminder: that breaks the reminder's no-words rule.

**Accepted.** `--again` is not bound by the reminder's session limit (`sessionsSinceWait`). The agent asks for its own wait, as it would by retyping it.

**Tests.** `server.waitagain-9219.test.js` replays a restart over the real route: every field comes back, and the refusals hold. `cli.waitagain-9219.test.js` covers both CLIs. Each fails without the change. Three tests that pinned the reminder's old command were updated.

**Weakest premise.** That an agent reads the reminder and acts on it. The command shortens the confirm step but does not make it happen.
