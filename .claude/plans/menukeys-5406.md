# menukeys-5406: answering Claude Code's question menu by key (kosmos#5406 part 2, slice A)

Finished means: while a Claude agent's live screen is its question menu (the AskUserQuestion tool) and the board has
the card as asking, a direct-message reply that is one of the menu's answer numbers (typed, or a button press with
its words) reaches the agent as that bare digit key, checked against the screen right before; any other reply closes
the menu with Escape first and then goes as an ordinary message; nothing is ever pasted into the menu. The board reads
the menu as a question with options (questionIn, optionsIn, questionAbove), so the thread GET serves them.

Measured (card comment): Claude Code 2.1.29x, a bare digit selects at once; the message path's paste is ignored and its
Enter takes the HIGHLIGHTED option (a silent wrong answer, today); Escape closes the menu and a message after it lands.

Design: status.claudeQuestionMenu (shape: footer "Enter to select ... Esc to cancel" within the last three non-blank
lines, consecutive 1..n options with optional indented description lines, one highlighted, a question line; refuses
several question tabs, checkbox menus, the safeguards menu, gaps). chat.answerQuestionMenu / closeQuestionMenu (keys
via keysAllowed, screen read before and after through viewport). Route: only when the route already captured the
screen because the card is asking (no extra read on ordinary messages).

Not in this slice: the buttons in the question's bubble (slice C, needs a screenshot); permission menus keep today's
path (part 1 stops them reaching the person).

Weakest premise: that the card is "asking" while this menu is up (measured through status.classify via the fleet
fixture). A managed agent whose own report says otherwise keeps today's path.
