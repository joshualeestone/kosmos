# leftovers-8547: delete what is left of every removed agent in one go (kosmos#8547)

## Finished looks like

A person (or an agent holding the board token) can run `kosmos agent delete-leftovers` on Windows, Mac or Linux and
clear the startup jobs (Windows Scheduled Tasks) and other leftovers of every removed agent, each through the board's
own per-agent delete, after one confirm, with nothing deleted that the board's Delete button would not delete with one
click.

## Why

Removing an agent only switches its startup job off (remove.js never deletes, so a removal can be put back). The job is
deleted only by "delete what is left", one agent at a time on the board. A Windows box that removed many agents keeps
one disabled task per agent: the feedback report counted hundreds.

## What it does

1. GET /api/removed: the removed agents plus the names with only settings left; deduped.
2. For each, GET /api/agent/<name>/leftover: the engine's plan (delete-leftover.js plan()).
3. Sorted:
   - `ok: false`: "Not offered for X: <the engine's reason>".
   - `typeToConfirm`: never done in bulk; listed as left for the board, where the reason is shown before typing.
   - with `--yes`, anything but `taskOnly`: listed as left, because a full delete retires the community account and
     tokens, which nothing brings back. `--yes` clears only startup jobs, which can be set up again.
4. Lists each one with its plan's `loses`, asks once (`Delete all N? [y/N]`) unless `--yes`.
5. DELETE /api/agent/<plan.name>/leftover with `{ confirmed: plan.confirm }`, one at a time, so the engine refuses any
   whose plan changed since it was listed (kosmos#8477).
6. A 409 (board restarting or busy) stops the run and names the ones not tried; a timeout after sending says "may";
   one refused delete is reported and the run goes on. Exit 0 only when everything listed was deleted and nothing left.

Both CLIs (tools/windows/kosmos-cli.js and install/kosmos), as the verb-parity guard requires.

## Decisions

- CLI first, no board button yet: no server change, every act goes through routes already reviewed. Rejected: a bulk
  server route (a second implementation of the confirm rules).
- Rejected: deleting the task inside remove.js (breaks the put-back removal promises).
- The card's piece 1 (Windows twin of the #6906 throwaway-agent cleanup) is dropped: the Mac gate that makes throwaway
  agents is a bash script against the Mac staging board, so it is not the Windows source. Weakest premise: that the
  leftovers on that box are the owner's removed agents rather than test agents; the bulk delete clears either.

## Tests

cli.agent-delete-leftovers-8547.test.js (Windows in process, Mac/Linux by execFile, against a stub board), with
controls; perturbation: removing the typed and --yes filters turns 4 Windows and 2 Mac tests red.
