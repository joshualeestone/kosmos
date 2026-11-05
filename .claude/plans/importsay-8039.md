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
   folder's entry. Inside a git repository Claude Code reads the answer under the repository root (measured), so the
   board answers only when that root IS the agent's folder. Refused, with a terminal ending: a root above the agent's
   folder (the answer would cover every folder in that repository, a scope the person cannot see before pressing), and
   a `.git` that is not a folder (worktree, submodule or link; where Claude Code reads it then is not measured). An
   answer already there is left alone and reported (`wrote: false`). Same read-modify-write hazard as `trustFolder`.
3. `engine/create.js` `declineAgentImports(name)`: the account the agent runs on, read from its job; reports
   `already`.
4. `server.js` `POST /api/agent/<n>/decline-imports`: the person's page only (isViaScreen); the screen is read again
   (409 if the question has gone); an answer already on file while the dialog is still up is a 409 with no restart (a
   restart would only bring the question back); a screen that cannot be read is a 409 that says so; otherwise write,
   restart, and say so. The thread route sends `importsAsk` from the same capture as the question, never in the setup
   guide's thread.
5. `engine/chat.js` `claudeMenuRefusal`: refuses at the dialog. An idle Claude card that has never taken a turn pays
   one fresh read for this question only, because the dialog draws at startup before the snapshot sees it. The
   sentence names the page's button only when the page draws it.
6. `web/index.html`: the box, its receipt (cleared when the question goes, and on agent switch), and the press handler
   (capture-and-recheck, like its twins). The receipt is inside the question box, so it is hidden with it once the
   restart takes the question away.

## Residual, stated
- An agent folder inside a repository rooted above it gets the terminal ending, not the button.
- An idle card that HAS taken turns before and restarts into the dialog (say, imports were added to its CLAUDE.md) is
  not freshly read while it reads idle; it is covered once the snapshot reads needs_you.
- Linux: the box's sentence names the terminal; the Open Terminal button is hidden there.
- Not walked on a real board end to end with this branch; the write and its effect were measured on 2.1.318.
- The project member thread route does not send `importsAsk`.
