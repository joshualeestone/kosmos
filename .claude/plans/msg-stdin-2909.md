# #2909 follow-up 2: `kosmos msg --stdin` (shell-safe direct messages)

## Finished looks like
`kosmos msg --stdin <agent>` (mac bash CLI and Windows node CLI) sends the piped text to the agent with
backticks, $, quotes, backslashes and newlines as written (tabs and CRs: see Decisions), with the same read rules as `kosmos post --stdin` (#3591): at most one byte past the board's
6 MB request limit is read (bigger is refused, no copy), control characters and a leading BOM are
dropped, the trailing CR/LF run is trimmed in linear time, and blank, terminal, and (Windows) cut-short
input is refused. Text args alongside --stdin, and a --stdin after the agent name, are refused. Every
failure after the read (Kosmos not running, too large, unreachable, refused, declined, a wrong-world
message the outbox could not keep) saves the message to a mode-600 file and names the path. Not saved,
on purpose: the "slow to answer" timeout (it may have been delivered, and a copy labelled "not sent" would
be false then; the sentence says to check before re-sending, the same call post makes).

Argument-mode msg (no --stdin) also changes, all deliberate:
- a timeout now exits 3 with "may have been delivered" (it exited 1 with "could not reach", a misdiagnosis)
- the body goes to curl on stdin (--data-binary @-) and an encoded body over 6 MB is refused before sending
- a standalone unquoted `--stdin` word in the typed text is refused (documented tradeoff)
- the escaper runs under LC_ALL=C, and a failure there is reported instead of aborting

## Decisions
- The stdin read is SHARED, not copied: post's block moved into `_read_piped_message` (bash) and
  `readPipedMessage` / `keepPipedCopy` (Windows), parameterised by verb (posted|sent) and usage
  example. Post's existing tests cover the refactor unchanged except the control-range pin, which now
  looks in the shared function.
- msg's escaper keeps flattening tab/CR to spaces (its existing behavior, pinned by tools/test-msg-newlines-1927.sh;
  delivery into an agent's pane flattens whitespace anyway). Known asymmetry: the Windows CLI sends tabs
  and CRs through JSON.stringify, so the stored record differs. Only LC_ALL=C and a guard
  (`if ! esc_text=...; then`) were added. tools/test-msg-newlines-1927.sh's extractor now accepts that
  form, so the #1927 test still runs cmd_msg's own pipeline (the first site), not reply's copy.
- A msg timeout (curl 28) is a "maybe", as on Windows: exit 3, do not re-send, no copy saved.
- Temp files are named kosmos-stdin-read / kosmos-unsent now that post and msg share them.
- Tradeoff, documented at cmd_msg: a standalone unquoted `--stdin` word in a typed msg is refused.
- msg's body goes to curl on stdin with the same encoded-size check as post.

## Weakest premise
As with post, the Windows path is tested with fake and PassThrough readers only, never through the
Git Bash shim on a Windows machine.

## Tests
cli.msg-stdin-2909.test.js (real install/kosmos vs a stub board), tools.windows-kosmos-cli-570.test.js
(#2909 msg case), plus the post suites for the shared reader.
