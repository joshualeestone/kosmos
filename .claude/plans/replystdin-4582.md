# replystdin-4582: `kosmos reply --stdin` (Mac and Windows CLIs)

Card: joshualeestone/kosmos#4582 (from #4580 item 5, four of five families).

## Goal
`kosmos reply --stdin` reads the reply to the person from standard input, as `post --stdin` and
`msg --stdin` do (#2909), so a formatted multi-line reply keeps its backticks and `$`.

## Done
- install/kosmos cmd_reply: leading `--stdin` via the shared `_read_piped_message`; refuses
  args-and-stdin and a trailing `--stdin`; reads before the health check so a piped reply is kept
  when Kosmos is down; `_keep_piped` on every failure after the read.
- install/kosmos cmd_reply now sends the body to curl on stdin (not argv) with the board's
  read-limit refusal, and a curl timeout (28) is a "maybe" (exit 3, nothing saved), matching msg and
  the Windows CLI (which already said exit 3 for a reply timeout). Before, every curl failure read
  "could not reach", exit 1.
- tools/windows/kosmos-cli.js verbReply: the same, via readPipedMessage / keepPipedCopy. Usage line
  identical in both CLIs (pinned).
- engine/defaults.js: "Formatted messages need line breaks" pipes the heredoc into
  `kosmos reply --stdin`; DOCTRINE_VERSION 19, logged, fingerprint pinned.

## Decided
- `--stdin` only, never an implicit read of piped input with no flag: a tool runner can hand the CLI
  an open stdin it never closes, and an implicit read would make every plain `kosmos reply "..."`
  wait on it. Same rule as msg/post.
- No client-side 2000-character check: the board owns that limit and says so; the whole piped text
  reaches it and a refusal keeps the copy.

## Limits
- PowerShell still cannot pipe into kosmos (kosmos.ps1 never reads $input); the here-string
  argument form stays the PowerShell answer. Git Bash on Windows gets --stdin.
- Agents that already hold the old doctrine copy keep the `IFS= read` form, which still works.

## Tests
- cli.reply-stdin-4582.test.js (11; 10 fail on origin/main's CLI, the CONTROL passes on both)
- tools.windows-kosmos-cli-reply-stdin-4582.test.js (7)
- engine/defaults.test.js updated (the reply example runs in bash and zsh with --stdin)
