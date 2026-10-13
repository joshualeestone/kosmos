# #6054: answer an agent's permission prompt from its page

**Branch:** `permanswer-6054` · **Card:** kosmos#6054 (priority, from feedback).

## Done looks like

An agent stopped on Claude Code's permission prompt can be answered from its page (desktop and phone: the phone app shows the same page): its own options are buttons, a press reaches the prompt as the option's digit, and the agent continues. A refused message points at those buttons, never at a window the person cannot reach. The card says "waiting for your approval". A test drives a fake prompt end to end.

## What existed

- The thread route already read the prompt off the screen as a question with numbered options (`chat.questionIn`, `chat.optionsIn`), but offered buttons only when `status.claudeQuestionMenu` recognised the screen, and that reads the AskUserQuestion menu, not this prompt. So the options showed with no buttons.
- Typing was refused with `CLAUDE_PERMISSION_SENTENCE`: "answer it in its window first". That is the dead end in the report.
- A careful key path existed for the question menu (`chat.answerQuestionMenu`, #5406): one press per pane, re-read the screen, refuse if the question or the option's words changed, send the digit, wait, re-read.
- The board already classified the prompt `needs_you` (scraped), and rule 3 of `reconcileReport` lets a scraped needs_you stand over a working self-report. Only its words were generic ("it is asking you something").

## Measured (Claude Code 2.1.296, 2026-10-13)

A throwaway session in a scratch folder, with no user settings (`--setting-sources project,local`) and `--permission-mode default`, asked to Write a file. The prompt: "Do you want to create notes-a.txt?", "❯ 1. Yes", "2. Yes, and switch to accept edits ...", "3. No", over "Esc to cancel · Tab to amend".
- A bare `1`, no Enter: the file appeared and the agent carried on.
- A bare `3` on a second prompt: "User rejected write to notes-b.txt", no file, and the agent went back to its prompt.

## The change

1. `status.claudePermissionPrompt(text)`: the prompt in the question menu's shape `{ at, question, options, count, permission: true }`, only for the `wording` kind (a "Do you want to / Would you like to" question). Refused (null) without its footer, with numbering not 1..N, with other than one highlighted option, with fewer than 2 or more than 9 options, or with a control character in a label.
2. `status.claudeAnswerableMenu(text)` = the question menu or the permission prompt. It is used at the four answering sites only: the press route's pressable check (the page's buttons), its not-a-menu check, its answer, and `chat.answerQuestionMenu`'s before and after reads. Closing with Escape stays the question menu's alone, because on a permission prompt Escape means No.
3. In the press route, words (not a pressed number) while a permission prompt is up are neither closed nor typed; delivery refuses them.
4. Refusals: `CLAUDE_PERMISSION_SENTENCE` and `CLAUDE_MENU_SENTENCE` end "answer it with the buttons under its question on its page in Kosmos", but ONLY where the page draws buttons (the permission prompt parses, or the menu is the single-select form). Any other form keeps "in its window", because there are no buttons for it. The press route's words-check refusal now points at this page.
5. `classify`: a permission prompt (`wording`) reads "it is waiting for your approval" (`status.APPROVAL_WAITING`). The three server sites that compare a card's reason with `ASKING_GENERIC` all require `stateReported === true`, and this reason is only ever scraped, so it is never taken for an agent's own question.

## Tests

`server.permission-answer-6054.test.js`, on the real 2.1.296 captures in test-support/claude-screens (Bash, 4 options; Edit, 3):
- the reader, with a control for each refusal;
- end to end through the thread route: GET serves the options as pressable (`asked` set); a press of Yes goes out as the bare `1`; No goes out as its own number (`4` on the Bash prompt); a stale press is refused with nothing sent; words are not typed, never send Escape, and the refusal points at the buttons; a prompt whose options do not read keeps the window ending;
- the card's reason, with the question menu as control.

Two old tests asserted the old design and are updated: #5406's "a permission prompt draws no buttons" (now: draws them, and a press is its digit), and its review-18 half (the words-check refusal is now the true reason). status.pane-states-1889 pins the new reason.

**Shown failing:** against main's status.js, chat.js and server.js, 5 of the 7 new tests fail (the reader, the buttons, Yes, No, the refusal wording). The 2 that pass on main are a safety refusal main already has and the guard against promising buttons that are not drawn.

## Validation

Status, chat, menu and thread suites, server.test.js, and the file-scanning guards: 1448/1448.

## Not in this card

Codex and Gemini approval prompts (not measured), iOS notification actions (#3870), auto-approval (#3417). The page's held-hello sentence for a menu ("answer it in its window first") also stays: it covers every menu form, including ones with no buttons.

## Weakest premise

That the option numbering and the digit-selects behaviour hold in later Claude Code versions. The key path re-reads the labels before every key, so a change makes it refuse, never press the wrong option.

## Rejected

- Typing "yes" as a message: the prompt ignores a paste, and the Enter after it takes the highlighted option (#5754).
- Enter for Yes: it answers whatever is highlighted.
- Only Yes and No buttons: option 2 changes the session's mode, and hiding it would make the page say less than the screen.
- Buttons for the `shape` case (other wording): it may be one of Claude Code's own pickers.
