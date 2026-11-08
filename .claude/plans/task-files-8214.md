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

Tests: cli.task-files-8214.test.js. Perturbed: BUILT_FIELDS without the path, the Tasks view not stripping it, the
Mac CLI not sending it, the network-path refusals, the Mac's physical resolve, the platform rule: each turned a test red.

Review calls (challenge loop):
- One rule for a kept path, engine/fileprint.js keptPath, asked by the board, both CLIs and task files: absolute, no
  control character, 1024 at most, no empty, . or .. segment, not //host, \\host, /net or /Network. A prefix check
  alone was walked round by /tmp/../net/host, which is why it reads every segment.
- On the reader, task files also refuses any path that reaches one of THIS computer's automount folders, read from its
  own mount table (mount on a Mac, /proc/self/mounts on Linux), not from a list of names: the list was walked round by
  /System/Volumes/Data/home, and /home on a Mac is a link into it. The path is walked one name at a time with lstat,
  links followed one hop at a time, so nothing is looked up inside an automount folder, and a link planted elsewhere
  that points into one is caught at the hop. A mount table that cannot be read opens nothing, and says so.
  Measured on this Mac: the only autofs mount is /System/Volumes/Data/home; /net does not exist.
- task files opens other markers' paths too: deliberate, it is the sweep the card asks for. It reads only what this
  agent can already read, and only this agent sees the output.
- task files exits 0 whatever the verdicts: it is a report like task list, and exit 1 already means it could not list.
- A path the board would refuse is dropped by the CLI, which says so, and the mark still goes.
