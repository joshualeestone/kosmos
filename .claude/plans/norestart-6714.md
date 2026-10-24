# norestart-6714: the restart notice counts real agents, can be dismissed, and is a compact notice (kosmos#6714)

**Card.** Josh, #admin 2026-10-20 08:35, on tmnt's board: "i need a dismiss option, and also this is an ugly 100% wide
button. this is not a real agent but my only option is to set it to start at login". The banner named
`leftover-unrelated`, a folder a test left on 2026-09-27 holding only a CLAUDE.md, which had never run. Asked: (1) count
only real agents; (2) a remembered Dismiss per agent, with a way back in Settings; (3) a compact notice, not a 100%
card; (4) a choice per real agent: start at login, or remove.

## Calls
1. **Real agent = has run here** (`register.hasRun`): a liveness record (written when a running agent reports in, since
   #2558) or a self-report history (older). Measured on this machine: every real agent has both; the leftover and the
   `zz-test-*` leftovers have neither. Rejected: profile keys (real agents have the sparsest profiles), folder contents
   (a CLAUDE.md is exactly what the leftover had), `created.jsonl` (agents made before it existed are not in it).
   It fails toward "not run", which can only leave something off the notice, never start it.
2. **Dismiss** is the notice's x, stored on the board (`restart-notices-hidden.json` in the data root), so it holds on
   every device. It changes nothing about whether the agent comes back, so it is named for what it does ("Stop
   reminding me about <name>") and Settings > Computer lists the hidden ones with Show again (`/api/register/hide`,
   `/api/register/show`; hide accepts only a name the notice shows). An unreadable file hides nothing. Josh's
   ruling overrides the earlier recorded design ("a state with a remedy has no dismiss": web.survival.test.js, the
   SURVIVAL_BUSY doc block); both are rewritten to say so.
3. **Compact notice**: one `.utoast.survival` per agent in the floating notice stack (`#survival-slot`, under the login
   notice), the board's existing notice shape, amber like an expiring login; up to 3 each on a desktop, 1 on a phone,
   past that one notice names them all with "Start them at login". On a phone the buttons take their own row.
   `#restart-wrap` (the full-width card) is removed. The consolidated layout now shows it too, as a floating notice
   (#520 kept full-width bars off that grid; the floating stack is where its notices go).
4. **Per agent**: Start at login (`POST /api/register` with `{ name }`; the repair accepts only a name the survey
   offers, so the set it acts on is still what the GET reports), and Remove..., which opens the agent page's own
   removal dialog with the engine's own question (`/api/agent/<name>/removal`), never a second copy.

**Never started, decided (review 2).** An agent that was created and never ran is not on the notice either. That is
Josh's rule in his words ("a login it has run"), and a restart takes nothing from it. The case a reviewer raised, a
created agent whose login job failed to install, does not persist: create rolls an agent back when its job was not
written (create.js, `if (... || !wroteJob) { rollBack(); ...}`, outcome partial), and on Windows when the job did not
appear (`undo(appeared.because)`, win32StartViaJob). The leftover Josh saw was a test agent whose create reported success and
which never ran. The five fixture files that now record a run model agents that have run, which is what each of those
tests is about (repairing an agent that lost its job), not a way around the rule.

**Hidden names are forgotten once the agent starts at login** (review 2), so a later loss shows the notice again.

**Kept, decided (review 8).** A hidden name is forgotten when its agent's job reads present. "Present" is the plist file
existing, which reads true only once a job is really written, so this cannot drop a dismissal on a flicker; and a later
loss showing the notice again is the intended behaviour (pinned in register.test.js).

**Decided (review 12).** Hiding a notice is behind the remote step-up (a stale remote session could otherwise silence
a warning); Show again is not. A notice held by an open report keeps its layout across a rotation until the report
closes (self-heals). Two Kosmos copies sharing one data folder could race on the hidden list; no such setup exists today.

**Behaviour change, stated.** An imported agent a company policy held has never run here, so it is no longer on the
notice (before, it was listed and Repair refused it with the policy's reason). It loses nothing on a restart.

**Done when.** A profile and folder that never ran are not on the notice and Repair never starts them; each real agent
has its own compact notice with Start at login, Remove and an x; the x is remembered and Settings shows it again;
nothing on the page is full width; phones get a readable notice with 44px targets.

## Tests
- server.register-routes-6714.test.js (3): the routes over HTTP (no body, `{}`, `{name}`, a non-string name, bad JSON;
  refused 400 vs failure 500; hide/show name rule and a hide with no notice).
- engine/register.test.js (57): never-ran is left off and never repaired (CONTROL: an agent that ran); a self-report
  alone counts; hide/show and Repair-all skipping hidden; only offered names can be hidden; an unreadable hidden list
  hides nothing; one-agent Start at login. Mutation: dropping the `ran` filter reds the never-ran arm.
- Fixtures in five more engine tests record that their agents ran (linuxwiring, gemini-grok, world-guard, win32-570,
  qwen-review2), since the survey now requires it.
- web.survival.test.js (23): notice per agent with its three actions, names spoken, cap and combined notice, escaping,
  failed look leaves the screen, Settings list, slot present and #restart-wrap gone.
- Browser: render-survival.js on a sandboxed board, dark and light: 2 notices (the never-ran folder absent), each
  460px wide, Remove opens the dialog about that agent, x hides and Settings lists it, Show again restores it, Start
  at login reports per agent and leaves the other alone. render-home-phone-718.js, chromium and webkit: 104 PASS,
  including Start at login and the x at 44px. mobile-shots.js restart screens re-pointed.

**Weakest premise.** That every real agent has reported at least once. An agent that has never reported (a runner
with no report hook) would not be offered. Measured: every agent on this fleet has a record.
