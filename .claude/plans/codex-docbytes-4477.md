# codex-docbytes-4477: Codex agents read their whole AGENTS.md

Card: joshualeestone/kosmos#4477 (filed by Angel from #4467's review; claimed and prioritised by
Splinter 22:44 CDT, fix decided by Angel).

## Finished looks like
Every Codex agent Kosmos launches, on Mac and Windows, is started with codex's AGENTS.md limit
raised to Kosmos's own instruction-file cap (256 KiB), so the tail of the file (Kosmos's own
rules, appended after the person's brief) is never silently dropped. A test holds both launch
sites and the cap to one number. One real Windows Codex launch is confirmed by Homer.

## Measured, not assumed (codex-cli 0.149.1 on this Mac, `codex debug prompt-input`, an empty
isolated CODEX_HOME, no account)
- A 42 KB AGENTS.md with a marker as its last line: the marker is ABSENT by default (the file's
  earlier text is present), so codex cuts the tail.
- With `-c project_doc_max_bytes=262144`, placed before or after the subcommand: marker PRESENT.
- `codex -c ... exec resume --help` parses, so the top-level placement works for the Windows
  `exec resume` turn too.

## Decision
- Raise the limit per launch with `-c project_doc_max_bytes=<workerfile.MAX_BYTES>`:
  - Mac: `bin/agent-supervisor.sh` (DOCBYTES_CFG, on both codex launch lines, beside NOTIFY_CFG).
  - Windows: `engine/win32codex.js` codexTurnArgs, a top-level `-c` before `exec`, computed from
    workerfile.MAX_BYTES.
- Rejected: trimming the Kosmos block (only moves the cliff), moving Kosmos text out of AGENTS.md
  (codex has no other file it always loads), writing the key into the agent's config.toml (would
  touch the person's own ~/.codex/config.toml for a default-account agent).
- Test: engine/codex-docbytes-4477.test.js pins the Windows argv, every Mac codex launch line,
  and both values equal to workerfile.MAX_BYTES.

## Weakest premise
Windows: the argv is unit-tested here but no real Windows Codex launch has been run with it.
Asked of Homer on the card. Also: a codex pane already running keeps its old launch arguments
until its next launch (after the release reaches it).
