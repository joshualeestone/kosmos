# Plan: #2909, tell agents how to send line breaks

## Finished looks like
Every agent's instructions (new ones, and existing ones through the consented refresh) say how to
write a formatted message across several lines on each surface that keeps line breaks, with
examples that work when copied, so the headings and lists doctrine #10 asks for can reach the
person.

## What is true, read from the code (2026-09-24)
- **Room posts keep line breaks** (#2239: `messages.js` stores `chat.storeText`).
- **An agent's reply to the person keeps them** (#1927: `/api/reply` -> `keepAgentReply` ->
  `chat.appendMessage`, which stores `storeText`).
- **`kosmos msg` to another agent does NOT**: `messages.send` stores `chat.cleanMessage`, one line.
  The pane copy an agent receives is always one line too.
- `kosmos post` takes a leading `--stdin` (PR #3591). `kosmos reply` takes only an argument (`text="$*"`),
  and a multi-line argument keeps its breaks. `kosmos msg --stdin` exists (PR #3604) but the board
  flattens the result, so it is not offered as a way to format.
- PowerShell cannot pipe into kosmos (`kosmos.ps1` never reads piped input); a single-quoted
  here-string argument keeps its line breaks through the JSON hand-off to `kosmos-cli.js`.
- Doctrine #10 asks for headings and lists and never says how to send a line break.

## What was measured, and how thin it is
- This board's store (`messages.jsonl`) holds 161 records. Only ONE is a room post since #2239 made
  posts keep line breaks, and it has none. The rest are refusals, older records, or `kosmos msg`
  messages, which cannot hold a line break at all. So the local evidence is one post; the change
  rests on the mechanism, not on a measured rate.
- Examples run as generated (extracted from `defaults.sections()`, not retyped) in bash 3.2 and
  zsh: both deliver the multi-line text intact.
- `"$(cat <<'KOSMOS_MSG' ...)"` for the reply was tried first and REJECTED: macOS's bash 3.2 fails to
  parse it when the message contains an apostrophe. The `IFS= read -r -d '' msg` form works in both.

## Change
`engine/defaults.js`: a NEW section, `### Formatted messages need line breaks`: rooms through
`kosmos post --stdin` with a quoted heredoc; replies by reading the heredoc into a variable and
passing it to `kosmos reply` (`read ... || true`, since `read` ends non-zero at the end of its input and `set -e` would otherwise stop before the reply); `kosmos msg` stated to
be one line, so not worth formatting; PowerShell through a single-quoted here-string argument, with
its unrenameable `'@` ending called out. Heredoc delimiter `KOSMOS_MSG`, not `EOF`, so a message line
reading `EOF` cannot end it early. DOCTRINE_VERSION 14 -> 15 (14 was taken by #3672, dm reactions, while this was in review), logged, fingerprint pinned; a test
pins the per-surface forms and that the section runs to its last sentence with the usual next
section after it (a `### ` line in an example would split the block; red control: one injected
inside the PowerShell example makes that assertion fail).

A new heading rather than an edit inside #10, for the same reason as versions 5 to 13:
`missingFrom` matches by heading, so only a new heading reaches agents that already exist.

Rejected: a machine-readable capability endpoint (the card's larger proposal); nothing would read
it. Rejected for now: making `kosmos msg` keep line breaks (a product change to agent-to-agent
storage, its own card if wanted).

A committed test extracts the section's two shell examples and runs them in /bin/bash (3.2) and
/bin/zsh under `set -euo pipefail` against a stub `kosmos`, with an apostrophe, backticks and `$` in
the message (red control: without `|| true` it fails).

## Weakest premise
That agents skip line breaks for want of the how, not by ignoring #10. The local evidence is one
room post. Re-measure room posts after this reaches agents.
The PowerShell form was measured on pwsh 7.6 on macOS, not on Windows PowerShell 5.1 under Codex,
the only runner that uses it.
