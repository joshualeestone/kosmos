# muse-run-3939: Meta's Muse Code, slice 2 (engine): one turn, and what it said

Card #3939. Slice 1 (merged 03bf99deb) finds Muse and reads its version. Splinter, 02:09: carry on with slice 2, engine side only (the runner launch and the session read), no page changes.

## What finished looks like
- engine/muserun.js: turnArgs() builds one `muse exec --json` turn: --workspace (resolved real path) and --session-id on every turn, --approval-mode (on-request by default, only Muse's three modes), --trust-workspace, --no-foreign-personal-context, --user-input-auto-resolve, and the prompt last after `--`.
- parseEvents() reads the JSONL into { sessionId, model, text, done, terminal, events, unreadable }: the final answer from run.terminal.completed, else the deltas joined; a line that is not JSON is counted, not guessed.
- runTurn() runs one turn in the agent's folder through the live-execution gate, SIGKILL at the timeout, a hard cap, never rejects; ok only when Muse exits 0 AND the turn completed; otherwise says why in words (busy session, not signed in, timed out, stopped early, could not run).
- Not wired into agent creation or any page; HOME never overridden (the environment passes through).

## Decisions and weakest premises
- `--` before the prompt, so a prompt starting with "-" is never read as a flag. Weakest premise: Muse's CLI honours `--` (standard for its kind; the captures pass the prompt without it). The signed-in run confirms.
- --trust-workspace: the agent's folder is Kosmos's own and Muse reads AGENTS.md only when trusted. --no-foreign-personal-context: keep other tools' personal rules out (not yet observed what it excludes).
- The error words key on the stderr lines the research captured ("already in use", "missing meta credentials"); an unknown failure is "could not run", never a guess.

## Next
- Slice 3: sign-in state and the provider row, after one signed-in Mac run (Josh approves one device code on the Mortals Mac). Then wiring runTurn into the agent runner.
