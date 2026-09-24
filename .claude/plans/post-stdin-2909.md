# #2909 follow-up: `kosmos post --stdin` (shell-safe room input)

## Finished looks like
`kosmos post --stdin <project>` (mac bash CLI and Windows node CLI) sends the piped text to the board as written
(backticks, $, quotes, backslashes, newlines, tabs, inner CRs; trailing CR/LF run, a leading BOM
and non-whitespace control characters such as ESC are dropped), combines with --no-reply and --in-reply-to in any order, and refuses
(exit 2, nothing sent) when args are also given, when nothing (or only whitespace/control characters)
is piped, when stdin is a terminal, when the pipe went quiet without ending (Windows only, same
guard as feedback write), or when the encoded request body is over the board's 6 MB request-read limit
(measured after JSON escaping; the room's own, much lower text cap refuses with its own sentence).
Without --stdin the message source is unchanged; the bash escaper's tab/CR/control handling does
change for argument-mode posts too (see Decisions). With --stdin, both CLIs read the pipe first (a
live pipe cannot be replayed); any failure after the read (Kosmos not running, too large, unreachable, refused, declined, or a wrong-world
post the outbox could not keep) saves the message, as it would have been posted, to a mode-600 file
and names its path, on both CLIs. Not saved, on purpose: the "still delivering" timeout (the post may
have landed and the sentence says not to re-post) and a Windows pipe that went quiet (refused as
possibly cut short). A --stdin after the project id is refused. "As written" is about what reaches the board: the room's display still
collapses tabs and CRs.

Known asymmetries, accepted:
- The #2710 echo-back of refused argument-mode text exists only in install/kosmos (it predates this
  branch); a refused --stdin message is saved to a file on both CLIs.
- bash has no quiet-pipe time limit (same as `feedback write` there): an open pipe nobody writes to
  blocks until the caller closes it. The Claude Code Bash tool hands commands /dev/null, so agents on
  it are not exposed.
- PowerShell: kosmos.ps1 never forwards piped input, so --stdin cannot work from PowerShell; the
  empty refusal carries the existing POWERSHELL_PIPE_NOTE. Git Bash (kosmos.sh execs node) works.

## Decisions
- Both CLIs stop reading just past the board's 6 MB limit (bash: one byte past; Windows: at the chunk
  that crosses it), judged on the raw bytes, and refuse (without a saved copy) anything bigger, so an
  accidental huge pipe is never held whole or truncated.
- Windows --stdin waits up to 120 s for a quiet pipe (feedback triage's limit), not 3 s: a piped
  command such as `gh` can be slow to start.
- Argument-mode control-character dropping is bash-only (its hand-rolled escaper would emit invalid
  JSON); the Windows CLI's JSON.stringify escapes them, so a Windows arg post still carries them.
- Bytes that are not UTF-8 are passed through (bash escaper runs under LC_ALL=C) and the board
  decodes them to U+FFFD, same as the Windows CLI, instead of aborting on `tr: Illegal byte sequence`.
- bash cmd_post now sends its JSON body to curl on stdin (`--data-binary @-`), so a long piped message
  cannot overflow argv, and JSON-escapes tab/CR instead of flattening them (this also changes
  argument-mode posts: a tab in an arg now arrives as a tab, and a control character such as
  ESC in an arg is now dropped instead of producing invalid JSON). cmd_msg and the others keep their
  existing escaper; out of scope here.
- Leading flag, same convention as --no-reply. Rejected: `-` as the message arg (collides with a
  message that is literally "-").
- Scope: post only. `kosmos msg --stdin` is the same hazard on a different verb; left for a follow-up
  on the card rather than widening this PR.
- Generated agent instructions NOT changed here: their single-quote advice is still true, and a new
  heading is the only way an edit reaches existing agents (engine/defaults.js version log). Worth a
  follow-up once msg has --stdin too, so the advice covers both verbs.
- Capability endpoint (kosmos-room-richtext-v1) stays deferred: nothing consumes it.

## Weakest premise
The Windows CLI's --stdin path is tested with a fake reader and with the real readStandardInput over a
PassThrough stream, but never through the kosmos.sh (Git Bash) shim on a Windows machine.

## Tests
cli.post-stdin-2909.test.js (real install/kosmos vs stub board, with a /bin/sh control proving the
hazard, and a python pty test for the terminal refusal), tools.windows-kosmos-cli-570.test.js #2909 case.
