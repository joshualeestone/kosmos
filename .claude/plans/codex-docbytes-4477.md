# codex-docbytes-4477: Codex agents read their whole AGENTS.md

Card: joshualeestone/kosmos#4477 (filed by Angel from #4467's review; claimed and prioritised by
Splinter 22:44 CDT, fix decided by Angel).

## Finished looks like
Every Codex agent Kosmos launches, on Mac and Windows, is started with codex's AGENTS.md limit
raised to 512 KiB (twice Kosmos's 256 KiB instruction-file cap), so the tail of the file (Kosmos's own
rules, appended after the person's brief) is never silently dropped. A test holds both launch
sites and the cap to one number. One real Windows Codex launch is confirmed by Homer.

## Measured, not assumed (codex-cli 0.149.1 on this Mac, `codex debug prompt-input`, an empty
isolated CODEX_HOME, no account)
- A 42 KB AGENTS.md with a marker as its last line: the marker is ABSENT by default (the file's
  earlier text is present), so codex cuts the tail.
- With `-c project_doc_max_bytes=262144`, placed before or after the subcommand: marker PRESENT.
- With `-c project_doc_max_bytes=524288` (the value shipped), before the subcommand: marker
  PRESENT; the default re-run in the same session: marker ABSENT.
- `codex -c ... exec resume --help` parses with the top-level placement the Windows `exec resume`
  turn uses (parsing only; that it takes effect there is reasoned, see Limits).

## Decision
- Raise the limit per launch with `-c project_doc_max_bytes=<workerfile.MAX_BYTES>`:
  - Mac: `bin/agent-supervisor.sh` (DOCBYTES_CFG, on both codex launch lines, beside NOTIFY_CFG).
  - Windows: `engine/win32codex.js` codexTurnArgs, a top-level `-c` before `exec`, computed from
    workerfile.MAX_BYTES.
- Rejected: trimming the Kosmos block (only moves the cliff), moving Kosmos text out of AGENTS.md
  (codex has no other file it always loads), writing the key into the agent's config.toml (would
  touch the person's own ~/.codex/config.toml for a default-account agent).
- Test: engine/codex-docbytes-4477.test.js pins the Windows argv, the Mac codex launch lines it
  recognises, and both values equal to twice workerfile.MAX_BYTES (the behavioural guard is the
  shell test below); tools/test-supervisor-model-2140.sh runs the real
  supervisor against a stub tmux and asserts `-c project_doc_max_bytes=524288` in both codex arms
  and not in the claude arm.

## Limits, stated
- Twice the cap. Kosmos never lets its own file exceed MAX_BYTES (every append and every
  instructions.write checks the whole file), so 1x would cover Kosmos's own file. 2x is for codex
  spending one budget across every AGENTS.md from the repository root down, and for a file a
  person hand-edits past the cap. The extra memory is trivial.
- win32launch.argvFor also builds interactive launches, but win32supervisor routes codex to the
  per-turn loop (win32codexsup), so codex never takes that path.
- A person's own higher `project_doc_max_bytes` in their config is lowered to 512 KiB for Kosmos
  agents (a -c always wins).
- codex counts the budget across every AGENTS.md from the git root down; an agent folder inside a
  repo with its own AGENTS.md shares the budget with it.
- The Windows `exec resume` case is reasoned, not measured: the flag parses there (`--help`), and
  the measured case is `debug prompt-input`. A Windows codex thread started before this change may
  keep its old instructions if its thread id survives an update.

## Weakest premise
Windows: the argv is unit-tested here but no real Windows Codex launch has been run with it.
Asked of Homer on the card. Also: a codex pane already running keeps its old launch arguments
until its next launch (after the release reaches it).
