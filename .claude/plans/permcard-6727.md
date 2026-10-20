# permcard-6727: a permission prompt is a short card in chat, not the terminal's screen

Card: kosmos#6727 (Josh, 2026-10-20 09:15, via Splinter).

## Why
When a Claude agent stops on its permission prompt, the agent's chat shows the prompt's whole box as text
(chat.questionIn returns it for the thread route, withQuestionRow makes it the question row, the page prints it): the
command, dashed rules, Claude Code's own warnings, "Do you want to proceed?", numbered options and "Esc to cancel · Tab
to amend". Josh saw about 30 such lines in a chat with Renet Tilley.

## What changes
1. Server: when the question read off the screen is Claude Code's permission prompt that may be answered by key
   (status.claudePermissionPrompt and chat.permissionAnswerable, the same gate the buttons use), the question carries
   `permission`: the box's title ("Bash command", "Create file", ...), Claude's own one-line description of the action
   when the box has one, a warning line when Claude Code drew one, and the raw command or file text for the details.
   withQuestionRow copies it onto the row.
2. Page: a question row with `permission` is drawn as a card:
   - "<Agent> wants to <plain kind of action>." from the title (run a command; a command that deletes files when the
     warning names a deletion; create a file; change a file; fetch a web address; otherwise "do something that needs
     your permission"), and Claude's description under it when there is one.
   - Allow and Deny: the prompt's own "Yes" and "No" options, pressed through the existing choice path (one key, its
     in-flight and answered locks), so nothing new reaches the pane.
   - "Show details", collapsed: the raw command, and the prompt's other options (the lasting ones keep their
     press-twice arming).
   - No terminal chrome anywhere: no rules, no numbered options, no key hints.
3. Tile: "Needs permission" where it said "Waiting for you" for a permission prompt.

## Decided
- Reuse the existing choice path (dmChoicePress and the thread POST) instead of a new key route: it already sends one
  key, refuses a changed question, locks against a double press, and arms lasting choices.
- The card only where the buttons are already offered (the whole box on screen). Otherwise the old text stays: a
  card with no buttons would promise an action it cannot take.
- Deny is the prompt's own "No" option, pressed by its number (measured on 2.1.296: "3" rejected a write). Escape is
  not added: it is a second key path for the same answer.

## Tests
Engine: the permission fields from the captured bash and edit screens (test-support/claude-screens), the dangerous-rm
wording, a trust prompt (not a permission card), a question menu (not one). Page: a browser check that draws the card,
presses Allow and Deny (the POST carries the right number), shows the details collapsed, and shows no chrome.

## Weakest premise
That the box's title and description lines are stable across Claude Code versions. Measured on 2.1.296 only. When
they are missing the card still says "needs your permission" and the details hold the raw text.
