# kosmos#8214: kosmos task files

Plan (on the card, 2026-11-07): keep the delivered file's absolute path beside its fingerprint, and a read-only CLI
verb that fingerprints each built task's file again on the agent's own computer.

1. engine/tasks.js: `builtFilePath` in BUILT_FIELDS; setBuilt takes `filePath`, absolute only, no control characters,
   1024 at most, only with a fingerprint. Kept and dropped exactly as the fingerprint is (a checker's or the person's
   mark keeps both; the sender's own mark without --file drops both; a new fingerprint without a path has none).
2. server.js: the built route passes `file_path`; the Tasks view strips builtFilePath as it strips landedRepo.
3. engine/tasklist.js filesLines: one copy both CLIs print. Verdicts: matches / CHANGED since it was marked /
   MISSING at / CANNOT READ / no path recorded. Comparison is engine/fileprint.js compare, the one kosmos fingerprint uses.
4. install/kosmos and tools/windows/kosmos-cli.js: `task files <project-id|--all>`, and built --file sends file_path.
   Windows resolves the path first and fingerprints that path, so the two name the same file.
5. task show prints the kept path, indented.

Rejected: a board-side sweep (the board may be remote and must not read arbitrary paths); re-marking on a mismatch.
Weakest premise: a path is the marking computer's; a mark from another computer reads MISSING here (said in the output).

Tests: cli.task-files-8214.test.js (7). Perturbed: BUILT_FIELDS without the path, the Tasks view not stripping it, the
Mac CLI not sending it: each turned one test red.
