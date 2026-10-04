# livetitle-5239: the Windows agent-page section is named for what it holds, not "Live output" (#5239; not day-one)

**Finished means:** on Windows the agent page's Terminal section (its accessible name, terminalTab) and its actions
box title (terminalBoxTitle) no longer promise output the section never shows; both read one name, pinned by tests.

## Decided
- Name: "Start-up and restart". On Windows the box holds Trust & Restart (Open Terminal is data-win-hide), whose own
  hint is "Approves this agent's folder so it can start without asking each time"; the window box below says there
  is no window (#5223 / PR #5226). Both keys keep one value (the a11y rule: section name = its title).
- Rejected: a real live view of the stream-json output (the card's option 2): a feature, not a rename; a separate card
  if wanted. Rejected "Restart": the section also holds the no-window note, and Trust is about starting.
- Mac copy unchanged ("This agent's Terminal").

## Weakest premise
That nothing else on Windows refers to the section as "Live output" in a sentence: grep of web/index.html, the
browser checks and the tests found only the table and the two test pins (plans excluded).

## Tests
web.win32-board-copy.test.js (both pins updated; new assertion the two keys match and contain no "output"),
web.place-names-5127, every file-scanning guard: 126/126.
