# fingerprints-6761: a compact task list, and a fingerprint on every shared file

Card: kosmos#6761, from a user feedback report (a project-manager agent, 2026-10-20). Asked:
1. a compact task-list filter (`kosmos task list --open | --blocked | --built`): one line per task (id, title, state,
   owner), a count line, never silently truncated;
2. a short sha256 beside every file in Files lists and handoff messages, and the CLI printing it on upload.

## What exists (measured from origin/main, 2026-10-20, by an explorer)
- `kosmos task list <project> [--state open|built|held|done]` (Mac install/kosmos cmd_task, Windows
  tools/windows/kosmos-cli.js taskList) calls `GET /api/tasks?project=&order=state[&state=]`. No cap anywhere: every
  row is printed. Each row is long: marks, the sentence, owners, who added it, parent, subtask counts, repeats, an
  indented "done when" and (#6330) an indented fingerprint line.
- `kosmos handoff [paths...]` (#6506) already prints `sha256:<hex>` for every path it is given.
- `kosmos task built ... --file <path>` (#6330) already hashes the delivered file and sends it with the mark, but its
  success line does not show the fingerprint.
- Files list rows (`projects.listFiles`) are `{ name, size, modified }`; both lists poll every 5 s. No content hash
  is computed or cached for them. Attachments (web upload) store no hash. No CLI uploads a file.

## Decisions
1. **Compact filters** are new flags on `kosmos task list`, in both CLIs: `--open`, `--blocked`, `--built` (the
   card's three; no `--done`, which a coordinator does not need and `--state done` already gives). Each prints ONE line
   per task:
   `#<n>  <state>  <owner>  <title>` (owner "nobody" when none; the title whole, newlines folded to spaces, never
   cut), then a count line: `<N> open tasks in <project>.` They use the route's existing `state=` filter.
   - `--blocked` is the board's `held` group (on hold, its own or a paused project's). Weakest premise: that the
     reporter's "blocked" means on hold, not "waiting on a decision" (taskState's `decision`). If a decision-waiting
     task is not held, it is listed by --open.
   - "Never silently truncated": the CLI checks the route's `count` against the rows it printed, and says so if they
     differ. Nothing is shortened.
   - `--state` and the long list stay as they are (their tests pin them).
2. **Fingerprints in Files lists:** each row carries `sha256` (hex) when it is known. A new engine module hashes files
   in the background, one at a time, keyed by (dev, ino, size, mtimeMs, ctimeMs), so a 5 s poll never re-reads an
   unchanged file and never waits on a hash. A row shows the first 12 hex digits after its size, with the whole
   value as hover text; a file still being hashed shows nothing yet, and the list's stamp includes the fingerprints,
   so it repaints when they arrive. Files over a size cap are not hashed (the row says nothing rather than a guess).
3. **Handoffs:** already print the full sha256 per named file; no change unless the review finds a gap.
4. **On upload:** the CLI's only file hand-off is `task built --file`; its success line will print the fingerprint
   it sent. Web uploads (attachments) get a sha256 in their record (the bytes are in hand at save), shown on the card.

## Built so far (task list half, 2026-10-20)
- ONE renderer, `engine/tasklist.js` (`compactLines`), run by both CLIs: install/kosmos through `node tasklist.js
  compact <state> <project>` (via kosmos_engine_node / kosmos_engine_module, as `kosmos handoff` runs handoff.js), the
  Windows CLI by require through engineDir(). A first try inlined the renderer in bash through a Python edit, which
  rewrote the JS escapes and broke the script (bash -n caught it); a module is also what keeps the two CLIs from
  printing it differently.
- The route's `count` is `rows.length` (server.js tasks route), so the "counted N but sent M" line only speaks when
  something between the board and the CLI dropped rows: a defensive check, not a live warning.
- An install without the module (older app) says so and prints nothing as if it were the group.
- cli.task-list-compact-6761.test.js: 7/7 (the renderer; both CLIs against a real board; an older board; a short
  answer; a module-less install; a hostile webhook title). Mutants, all red: --blocked asking for open, no title fold,
  no count check. Neighbours green: cli.task-list-state-5705, cli.task-webhook-1307, cli.task-who-4887, cli.gaps-4891,
  tools.windows-kosmos-cli-570, bundle.contents, engine.reachable, fixture-discipline, the two Windows audits.
- The fingerprint half waits for #6724 (PR #6753) to merge: it changes the same Files views.
- `kosmos task built ... --file` (both CLIs) now prints `Fingerprint sent: sha256:<hex> for <file>` under the mark's
  sentence: whole, so a copy can be checked against it exactly (the list rows show a short form). Asserted in
  server.builtsha-6330 (Mac) and tools.windows-kosmos-cli-570 (Windows, with a control that no --file prints none);
  mutant (the line removed from both) red in both.
- engine/filehash.js (background sha256 for Files rows, keyed by dev/ino/size/mtime/ctime, never on the request, a file
  changed mid-read not cached, O_NOFOLLOW): engine/filehash-6761.test.js 5/5; mutants red (no before/after check; a
  cache that ignores identity).
