# importsay-8039: answer Claude Code's external imports question from the board (#8039)

## What
A Claude agent whose instructions @import files from outside its folder stops at Claude Code's "Allow external
CLAUDE.md file imports?" before it can take a turn. Measured on a live 0.7.91 board: the chat shows the dialog as raw
text, no buttons, and nothing says the way through is the agent's Terminal. Enter on the dialog's highlighted row
("No, disable external imports") starts the agent and writes `hasClaudeMdExternalIncludesApproved: false` plus
`hasClaudeMdExternalIncludesWarningShown: true` for the folder (measured on 2.1.318).

This change:
- offers "Continue without them" under the question on the agent's page; it writes what No writes and restarts the
  agent, typing nothing into the terminal (the Trust & Restart shape);
- leaves Yes in the Terminal, since that is the answer the dialog warns about;
- refuses a typed line (chat, room post, `kosmos msg`) while the dialog is up, because its Enter would answer No and
  the line would be lost.

## How
1. `engine/status.js` `importsDialogIn(tail)`: a live consent dialog whose last Yes row is "Yes, allow external
   imports" with "No, disable external imports" beside it. Keyed on the answer rows, so a long import list that pushes
   the heading out of the tail still reads.
2. `engine/trust.js` `declineExternalImports(dir, opts)`: the write, under the account's write lock, merging into the
   folder's entry. Inside a git repository the key is the repository root (measured: Claude Code reads it there).
   Refused, with a terminal ending: a root at the home folder or above (the answer would cover nearly everything), and
   a linked worktree (`.git` is a file; where Claude Code reads it then is not measured). An answer already there is
   left alone and reported (`wrote: false`).
3. `engine/create.js` `declineAgentImports(name)`: the account the agent runs on, read from its job; reports
   `already` and `repo` (the root, when it differs from the folder).
4. `server.js` `POST /api/agent/<n>/decline-imports`: the person's page only (isViaScreen); the screen is read again
   (409 if the question has gone); an answer already on file while the dialog is still up is a 409 with no restart (a
   restart would only bring the question back); otherwise write, restart, and say so, naming the repository when the
   answer covers one. The thread route sends `importsAsk` from the same capture as the question.
5. `engine/chat.js` `claudeMenuRefusal`: refuses at the dialog. An idle Claude card that has never taken a turn pays
   one fresh read for this question only, because the dialog draws at startup before the snapshot sees it. The
   sentence names the page's button only when the page draws it.
6. `web/index.html`: the box, its resets on agent switch, and the press handler (capture-and-recheck, like its twins).

## Residual, stated
- An idle card that HAS taken turns before and restarts into the dialog (say, imports were added to its CLAUDE.md) is
  not freshly read while it reads idle; it is covered once the snapshot reads needs_you.
- Linux: the box's sentence names the terminal; the Open Terminal button is hidden there.
- Not walked on a real board end to end with this branch; the write and its effect were measured on 2.1.318.
- The project member thread route does not send `importsAsk`.
