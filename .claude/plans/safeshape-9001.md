# safeshape-9001: refuse up front the shell shapes Claude Code's own check puts to the person (part 2 of kosmos#9001)

Finished means: a Kosmos Claude agent that writes a Bash command Claude Code's built-in safety check would turn into a
self-declining permission prompt (one that reaches the person's phone) is refused by the report hook before it runs,
with the form that works, so the agent rewrites it at once; and every command that runs today without reaching the
person still runs.

## Measured (Claude Code 2.1.331, `claude -p`, bypass mode, no user settings, one command per run; 59 commands)
- Refused: the three characters `$$(` ANYWHERE (unquoted, single or double quotes, a comment, a quoted heredoc body);
  a zsh parameter flag `${(` unquoted, in double quotes, or in an UNQUOTED heredoc body.
- Run: `${(` in single quotes, a comment or a quoted heredoc body; `$?(` `$!(` `$#(` `$1(` `$0(` `$_(` `$-(` `$*(`
  `$@(` `$a(` `${a}(` `a$$b(`; escaped `\$\$(`; rm on a variable, unset variable, `$(...)` or loop path; `${=x}`,
  `${f:t}`; a python heredoc; a literal rm -rf of a folder under home.
- How found: the 9 real refusals of agents on this Mac (transcripts, 2026-11-09 to 11-24). 6 were zsh flags. Two
  python heredocs were bisected line by line (delta debugging, 10 runs) down to `page.$$('...')`. 1 (an rm -rf and two
  unlinks of literal folders, 11-19) did not reproduce.
- Why they reached the phone: Kosmos's PermissionRequest allow hook (#5406, Josh 2026-10-22) answers these prompts
  with allow, EXCEPT when the command names .claude, .claude.json or .git. 8 of the 9 did (a .claude/plans file,
  mostly). Reproduced in this session: a command of mine with `page.$$(` and `.claude` was declined by Claude Code.

## Built
- install/kosmos-report-hook.sh: `_shape_reason` (perl, JSON::PP) reads tool_input.command of a Bash call: `pid` for
  `$$(`, `zsh` for `${(` where the shell reads it (a small quote reader). On PreToolUse, when the raw input holds
  either, it asks Kosmos's allow hook (`allow_hook_allows`, split out of `kosmos_allows`, on the same payload renamed
  PermissionRequest) and refuses (exit 2, the way out on stderr) only when that hook would not answer.
- report-hook-shapeguard-9001.test.js: every measured case both ways, the allow-hook arm, the controls.

## Rejected
- Refusing every match: for most commands the allow hook already lets them run; a blanket refusal would block work
  that succeeds today (found by measurement mid-build, after a first version did exactly that).
- A fleet hook in ~/.claude: reaches only this Mac; the report hook reaches every Kosmos install.
- Refusing rm on a variable path or a cd into a variable folder (the card's guesses): Claude Code 2.1.331 runs them.

## Round 1 (opus, blind) fixes
- BLOCKER fixed: setup wires this hook into the person's own Claude Code too, where there is no allow hook and the
  prompt is theirs to answer; the first version refused there. Now only an agent with Kosmos's allow hook present
  (allow_hook_present, split out of allow_hook_allows) whose allow hook steps aside is refused. Tests: the person's own
  session runs, naming .claude or not; a fake allow-hook path is no hook. This drops the one real refusal from an
  agent with no allow hook (11-09): that prompt still shows, as today.
- `<<<` was read as a heredoc (its quoted word became a delimiter that swallowed later lines; failed open). Fixed.
- Backticks are now their own unquoted level, also inside double quotes. Remaining misreads documented in the header.
- JSON::PP in UTF-8 both ways (a non-ASCII command is re-encoded intact for the allow hook; tested).
- Messages: the $$( one keeps only the Write/Edit-a-file way (an unquoted heredoc expands every other $); the zsh one
  adds `paste -sd, -` for a join.
- Mutations checked: no own-session gate, no here-string rule, no backtick level: each turns the suite red.

## Round 2 (sonnet, blind) fixes
- WARNING fixed: an allow hook that could not be asked (node failed, past the 6 s clock, no temp file) read as "steps
  aside", so a command that runs today was refused. allow_hook_allows now returns 0 allow, 1 ran cleanly and did not
  answer, 2 could not be asked; the guard refuses only on 1. kosmos_allows reads any non-zero as no, as before (a node
  that printed allow is still allow whatever its exit). Tests: failing node, slow node (stopped by the clock), no temp
  folder all run; a clean node that answers nothing is refused (the control). The killed job is reaped quietly.
- WARNING fixed: the reader's cost is bounded: past 256 KB of command it lets the call run (tested both sides).
- Measured, not assumed: `\$$(` (a backslash before the first dollar only) IS refused by Claude Code (T80, T81), so the
  raw substring rule is right; both are now test cases.
- The zsh message says "also inside double quotes"; the test header no longer overstates what the RAN list controls.
- Mutations: refusing on any no, and no size cap: each turns the suite red.

## Weakest premise
The shapes are Claude Code 2.1.331's. A later version may refuse more (those still prompt, as today) or fewer (the
guard then refuses a command that would have run with a prompt the allow hook steps aside from; the message names the
working form, so the cost is one rewrite).
