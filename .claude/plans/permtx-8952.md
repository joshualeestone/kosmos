# permtx-8952: kosmos#8952 slice (d), a cut permission box approved from the agent's transcript

Finished looks like: a Claude Code permission prompt whose box top has scrolled away (a long Bash command) shows the
full card (Allow, Deny, the whole command under Show details) on the board and the iPhone thread, built from the
agent's own transcript, ONLY where the screen's visible lines agree with the one pending Bash call; an Allow press is
re-checked against the transcript on its last look; anything else keeps slice (c)'s deny-only card.

Design: card comment 7120105744 item 1. Premise measured: comment 7129385550.

## Steps
1. engine/permtranscript.js: pendingIn (exactly one unresolved tool_use, the last one, Bash), pendingCommands (recent
   transcripts in the agent's folders, tail 4 MB, fail closed).
2. chat.permissionCutCard (visible body minus the "│" gutter, whitespace-free suffix of exactly one pending command;
   whole match when the opening rule shows), permissionCutCardNow, setPendingReader for tests.
3. answerQuestionMenuHeld: a cut-box press with a request is approved only if the transcript card is read again now.
4. server.js: thread route serves the card (dmPressable cutVerified), POST request check accepts the cut card.
   The phone's lock-screen notice is unchanged (its 400-character cap excludes such commands anyway).
5. Tests: engine/permtranscript-8952.test.js, server.permtx-8952.test.js (mutation-checked), real 2.1.331 screen.

## Weakest premise
A reported safety check (Claude Code's hook-raised prompt) may write no tool_use; then it keeps the deny-only card.

## Challenge loop

#### Iteration 1 (opus)
- [BLOCKER] fixed: candidates came from every recent transcript in the folders, so a killed session's stale call could
  match the visible tail. Now bound to the pane's own session: tmux #{pane_pid} -> <config>/sessions/<pid>.json
  (measured on 2.1.331) -> that session's transcript and its subagents', newest file only, exactly one pending call.
- [BLOCKER] fixed: the transcript read widened the gap before the key; the screen is read again after it and must be
  byte-identical (test mutation-checked).
- [WARNING] fixed: per-file reading cached by size and mtime; tail 2 MB; only the session's own files.
- [WARNING] recorded, not built: a person's own PreToolUse hook returning updatedInput can change the command Claude Code
  runs while the transcript keeps the model's. Kosmos installs no such hook (no updatedInput anywhere in engine/).
  With a tail-only match, a hook that changes the head would show the original. Known gap; deny-only is unaffected.
- [WARNING] fixed: route test through the real read (pid, session file, transcript; sandboxed config root), a screen
  change during the read, a tail cut mid-line past TAIL_BYTES, stale and parallel-batch files.
- [NIT] fixed: a command holding control or format characters gets no card (it cannot be shown as it is).
- [NIT] kept: `says` is the model's description, the same text the whole box draws.
- [NIT] fixed: the session comes from the pane's pid, not workerDir(sessionName).

#### Iteration 2 (sonnet)
- [BLOCKER] fixed: only the newest file was judged, so parallel subagents could each hold a waiting call and the card
  could show the other one. Now every recent file of the session is read and exactly one call may be waiting across
  all of them (subagent launches, "Agent"/"Task", excepted), Bash, last in its file. Test with two subagents, and a
  waiting Write (mutation-checked).
- [WARNING] fixed: a cut box with under 40 visible non-space characters gets no card (one line like "done" agreed with
  almost any call).
- [WARNING] fixed: sessions/<pid>.json must be written by this process: its startedAt falls 5 s before to 120 s after
  the process start (now minus `ps -o etime=`; measured 1 to 6 s on three live agents). procStart text was rejected:
  it is written in the agent's own time zone (measured: UTC on one agent).
  Measured fleet-wide: 21 of 21 panes' pane_pid is claude with a session file; 4 of 4 sessionIds name the newest
  transcript.
- [WARNING] fixed: Yes and No must be the one-time options (!lasting).
- [WARNING] kept as recorded in iteration 1 (a person's own updatedInput hook).
- [NIT] deferred: no per-pid memo; a memo would let the press read the GET-time answer, and the reads are cached per file.
- [NIT] fixed: only a typed message (no tool_result, not isMeta) settles earlier calls (mutation-checked).
- [NIT] deferred: a second transcript read after the re-look; the key follows synchronously after the re-look.
