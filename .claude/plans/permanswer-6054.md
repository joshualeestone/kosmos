# #6054: answer an agent's permission prompt from its page

**Branch:** `permanswer-6054` · **Card:** kosmos#6054 (priority, from feedback).

## Done looks like

An agent stopped on Claude Code's permission prompt can be answered from its page (desktop and phone: the phone app shows the same page): its own options are buttons, a press reaches the prompt as the option's digit, and the agent continues. A refused message points at those buttons, never at a window the person cannot reach, and never at buttons the page does not draw. The card says "waiting for your approval". A test drives a fake prompt end to end.

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

1. **The reader.** `status.claudePermissionPrompt(text)` returns the prompt in the question menu's shape `{ at, question, options, count, permission: true }`. Only for the `wording` kind (a "Do you want to / Would you like to" question), never the safeguards menu. A label wrapped onto indented lines is joined into one whole option (a long Bash command wraps option 2). Refused (null) without its footer, with numbering not 1..N, with other than one highlighted option, with fewer than 2 or more than 9 options, or with a control character in a label. `chat.optionsIn` uses the same reader for this prompt, so the buttons the page draws are exactly the options the key path answers.
2. **The answering sites.** `status.claudeAnswerableMenu(text)` = the question menu or the permission prompt, used at the four answering sites only: the press route's pressable check (the page's buttons), its not-a-menu check, its answer, and `chat.answerQuestionMenu`'s before and after reads. Closing with Escape stays the question menu's alone, because on a permission prompt Escape means No.
3. **Identity, because the question line repeats.** "Do you want to proceed?" and "1. Yes" are the same on every Bash prompt, so a permission prompt is matched on what is above its options (`chat.questionAbove`, the existing every-meaningful-line rule) over its WHOLE box: `chat.questionIn` returns it from under the full-width rule that opens the box ("Bash command", "Create file") to its footer (review 2: the old six-line run-up cut a long command's head off). The person sees the whole command too.
   - **Only with the whole box on screen** (`chat.permissionAnswerable`, review 3). A box whose top has scrolled away (taller than the pane) gets no buttons, no key and no promise of buttons, because its visible tail could be another command's.
   - **Compared uncut** (review 3), in the route and on the last look: a tall command's distinguishing text can sit past any prefix. The question menu keeps its 2000-character bound.
   - The page sends the identity with a press (`asked`), the route checks it against its read, and `answerQuestionMenu` checks it again on its last look before the key and refuses without it ("we could not tell which request ..."). After the key, "still asking" means the SAME prompt by identity, so the next command's prompt is "answered" and the page never invites a second press that would approve it.
4. **Only a button press answers it.** A typed digit names no command, and "1" is Yes on every prompt, so typed it is words. Words while a permission prompt is up are neither closed (Escape there means No) nor typed; delivery refuses them and points at the buttons.
5. **Refusals.** `CLAUDE_PERMISSION_SENTENCE` and `CLAUDE_MENU_SENTENCE` end "answer it with the buttons under its question on its page in Kosmos" only where the page draws buttons: the menu is the single-select form or the permission prompt is answerable (whole box), the card reads needs_you (the page reads the screen only then; a working card can still show a prompt it reached mid-turn), the card's disruption has not failed, and it is not the setup guide (its thread is masked). Everywhere else they keep "in its window". The press route's words-check refusal points at this page, and offers typing the number only where typing works (not at a permission prompt). The unconfirmed sentence says to look at this page again before pressing anything.
6. **The card.** `classify` reads a permission prompt (`wording`, via its drawn option menu) as "it is waiting for your approval" (`status.APPROVAL_WAITING`). The three server sites that compare a card's reason with `ASKING_GENERIC` all require `stateReported === true`, and this reason is only ever scraped, so it is never taken for an agent's own question.

## Tests

`server.permission-answer-6054.test.js` (18 tests), on the real 2.1.296 captures in test-support/claude-screens (Bash, 4 options; Edit, 3):
- the reader, with a control for each refusal, and wrapped labels joined;
- end to end through the thread route: GET serves the options as pressable; a press of Yes goes out as the bare `1`; No as its own number (`4` on the Bash prompt); a press whose number and words disagree is refused; a typed digit is refused; words are not typed, never send Escape, and are told about the buttons; a wrapped option gets its button;
- identity: the last look refuses another command's prompt and a press with no identity; the next command's prompt after the key is "answered" (control: the same prompt is unconfirmed); two long commands differing at their head, and two tall ones differing only past 2000 characters, are told apart through the route; a box whose top has scrolled away gets no buttons, no key and no promise;
- refusals: the window ending stays for unreadable options and for a working card (control: needs_you says buttons); the words-check refusal does not offer typing at a permission prompt;
- the card's reason, with the question menu as control.

Updated old tests (they asserted the old design): #5406's "a permission prompt draws no buttons" (now draws them, and a press is its digit), its review-18 half (the words-check refusal is the true reason), and status.pane-states-1889's reason.

**Shown failing, one break per guard:** against main's status.js, chat.js and server.js, 5 of the first 7 tests failed (the reader, the buttons, Yes, No, the refusal wording); then, against this branch, each guard removed alone failed exactly its own test: the identity check on the last look, typed digits allowed, "still asking" by question line, no wrap join, the buttons ending always, no whole-box region, the box check always true, the 2000-character cut restored (in both the route and the last look), and typing always offered.

## Validation

Status, chat, menu, thread and projects suites, server.test.js, and the file-scanning guards, on the final code. The full suite runs in CI.

## Not in this card

Codex and Gemini approval prompts (not measured), iOS notification actions (#3870), auto-approval (#3417). The page's held-hello sentence for a menu ("answer it in its window first") stays: it covers every menu form, including ones with no buttons. On the page, `dmChoiceHead` no longer finds a head line for a permission prompt (its identity is several lines); the press still names its prompt through `asked`.

## Weakest premise

That the full-width rule above a permission prompt is the one that opens its box. A command whose own text contains a line of `─` characters would start the box lower, so its identity would miss the lines above that line. Two prompts would then collide only if they also agreed on everything below it. The numbering and the digit-selects behaviour are measured on 2.1.296 only; a change in the labels makes the key path refuse.

## Rejected

- Typing "yes" as a message: the prompt ignores a paste, and the Enter after it takes the highlighted option (#5754).
- Enter for Yes: it answers whatever is highlighted.
- Only Yes and No buttons: option 2 changes the session's mode, and hiding it would make the page say less than the screen.
- Buttons for the `shape` case (other wording): it may be one of Claude Code's own pickers.
- A typed digit as an answer: it names no command.
