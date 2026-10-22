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

## Row fingerprints (built after the first draft of this plan)
- projects.listFiles / listDir take `{ fingerprint: true }` and give `sha256` to the rows SHOWN (after the cap), never to
  every file walked; the stamp includes them, so a polled list repaints when one arrives. The agent /files, /files/browse
  and project /documents routes opt in. The page: `fileFingerprint(f)` accepts only 64 lowercase hex; the Files screen
  and the Documents view show `fingerprint <12 hex>`; the narrow lists keep size only and carry `fingerprint sha256
  <whole>` on hover. Branch stacked on filebrowser-6724 (same views) until that merges.

## Review
- Iteration 1 (opus): nothing security-relevant found. Findings, all addressed:
  - WARNING, fixed (measured by the reviewer: a 200 MB file appended to every 200 ms cost 1.8 GB of reads in 10 s): a
    growing file was re-hashed in full on every poll and never cached. It is hashed only once settled (5 s since its
    last write) and a file that changed while it was read backs off for 60 s. Tests for both, and the mutants red.
  - WARNING, fixed: the Documents view reads its list once, so rows sent before their hash stayed without one. A
    bounded re-read (every 2 s, at most 15) puts arrived fingerprints on the SAME files (name, size and date) and
    repaints in place; it stops once every row has one, and when the person leaves the view. Tested on the real function.
  - NIT, fixed: the cache now drops the least recently SHOWN first. NOT added: a byte budget per interval (the settle
    rule and the 512 MB per-file cap bound it; weakest premise: a folder of many large settled files, each hashed once).
  - NIT, fixed: the link test could not fail without O_NOFOLLOW; it now checks the open flags (mutant red).
  - NIT, fixed: the CLIs now agree on the error paths too: a refusal goes to stderr on both, an answer that is not a
    task list gets one sentence, and an empty word after the flag is refused on both. Tested strictly.
  - Wording: the rows say "fingerprint"; the hover names the algorithm (sha256) beside the whole value.
- Iteration 2 (sonnet): WARNING, fixed (measured by the reviewer: a file with a 2030 modification time never got one): the
  settle rule read the modification time, which a copy or an archive can set in the future; it now reads the change
  time alone, which the kernel sets on every write. Test with a future mtime; the mutant (back to mtime) red. NITs,
  fixed: the Documents fill's repaint kept the keyboard focus only by luck; the focused row gets it back (tested, mutant
  red). The Mac's two shell-side refusals go to stderr, as every other refusal on both CLIs.
- Iteration 3 (opus): WARNING, fixed: a cloud-only placeholder (iCloud Drive, a file provider) reports its full size, so
  reading it to hash made the system download the whole file because a list was shown. A file with no blocks here and a
  size above 0 is not fingerprinted (tested; mutant red). ACCEPTED, recorded: on Windows a OneDrive placeholder cannot
  be told by stat (no blocks reported), so it can still be recalled by a fingerprint read. Weakest premise: few Kosmos
  project folders live in OneDrive on Windows today. NITs, fixed: the compact rows keep the long list's `[added by X]`
  mark (#4887) and say an owner through its tree as `name (through #N)` (#5678), both tested (mutant red); the stamp's
  fingerprint part is JSON records, as the rest of the stamp, so a newline in a name cannot merge two.
- Iteration 4 (sonnet): NITs only. Fixed: the placeholder rule now starts at 1 MiB, so a small file with no blocks of its
  own (APFS compressed into an xattr, ext4 inline data) is fingerprinted (tested). ACCEPTED, recorded: a large SPARSE or
  compressed local file reports no blocks too and is not fingerprinted (Node's stat cannot read the dataless flag that
  would tell it from a placeholder); its row simply shows none. The Documents fill gives up after 15 reads (30 s): a
  folder of several large settled files may finish hashing after that, and its rows fill in on the next open. A browsed
  folder queues each of its up to 1000 files once (deduplicated), which iteration 1's declined byte budget would bound.
- Iteration 5 (opus): one NIT, fixed. A fingerprint arriving moves a list's stamp, so the three polled lists (the agent's
  narrow Files panel, the Files screen, the project rail) repaint with no file changed and dropped keyboard focus. Shared
  helpers rowKey / focusedRowKey / refocusRow now give focus back to the same row (by file or folder name) after each of
  those repaints; the Files screen's move-to-folder focus still wins. Tested (web.fingerprints-6761, two mutants red).
  Not done: patching rows in place when only fingerprints moved (a rebuild with focus kept is enough).
- Iteration 6 (sonnet): one WARNING, fixed. Giving focus back after a background repaint (refocusRow, and the Documents
  fill) used a plain focus(), which scrolls the row into view, so a person who had scrolled away was pulled back on every
  fingerprint. Both now use focus({ preventScroll: true }); the deliberate move-to-folder focus keeps its scroll. Tested
  (both arms assert the option; two mutants red).
- Iteration 7 (opus): one WARNING and one NIT, both fixed.
  - WARNING: the project rail's repaint also rebuilt the whole project conversation (so citations become chips), and a
    fingerprint arriving moves the rail's stamp, so the room was rebuilt with no name changed (an open reaction picker
    closed, a selection was lost). pjLoadDocs now rebuilds the room only when the folder's names changed
    (sameDocNames); the rail itself still repaints. Tested (unit arms with controls, plus the call site; mutants red).
  - NIT: the title holding the whole fingerprint is also each button's spoken description, so 64 hex were read aloud
    per row. Each row with a fingerprint now has `ariaDescription` with the short form (the narrow Files row keeps its
    date in it too); the whole value stays in the hover. Weakest premise: an engine without ARIA reflection ignores the
    property and falls back to the title, i.e. today's behaviour. The Documents view says the short form twice (row text
    and description), accepted as far milder than the 64.
  - Also found by running every web.* file (3123 tests): web.project-page lifted pjLoadDocs without the iteration-5
    focus helper, so 2 of its tests had been red since iteration 5. It now lifts the helpers pjLoadDocs calls.
- Iteration 8 (sonnet): one WARNING, fixed. The spoken short form was set through the `ariaDescription` reflection
  property, which an engine without ARIA reflection keeps as an expando nothing reads (back to 64 hex spoken). All
  three rows now use setAttribute('aria-description', ...); the test asserts the attribute and that no reflection
  property is used (mutant red). web.* 3123/3123.
- Mortals full suite at e2a0562db (2026-10-20 20:25): 22768 tests, 7 failed. Two were #6668's watchdog arms (known, load;
  #6768 fixes them). Five were this branch's, all fixed since: web.project-page's two pjLoadDocs tests (fixed in iteration
  7); engine.reachable (filehash's four test seams are now in SEAMS_5548, by file); the two #1732 audits (the stat key
  joins with '|', not ':', and the open flags are captured once each as FP_NOFOLLOW / FP_NONBLOCK with classified
  INVENTORY rows, as filepreview.js does, rather than a bumped count).
- Mortals full suite at fc716aaa5 (2026-10-20 20:48): 22769 tests, 22447 passed, 2 failed, 320 skipped. The 2 are
  #6668's watchdog arms (known, load; #6768 fixes them); nothing of this branch's.
- Iteration 9 (opus): two NITs, both fixed. (1) The iteration 3 ACCEPTED item's premise that Windows reports no blocks is
  unmeasured both ways (libuv may derive blocks from the allocation size, which would make the same rule catch a OneDrive
  placeholder there); the comment now says so and claims neither. A Windows measurement would settle it. (2) hashOne
  allocated a fresh zero-filled 1 MiB buffer per file; it now reuses one module buffer, which is safe because drain hashes
  one file at a time and only the bytes each read fills are hashed.
