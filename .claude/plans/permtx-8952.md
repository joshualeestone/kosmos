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
