# dotname-9070: the dot-name refusal is true off a Mac (kosmos#9070, found by PigeonPete reviewing #9064)

Finished means: a project name starting with a dot is still refused on every platform, with words that are true on
each ("a name starting with a dot can make a hidden folder, so pick another"), on main.

## Built
engine/projects.js folderNameProblem: the one sentence, and a comment saying why. No test pins it (grep of every
*.test.js for the old words and for "starting with a dot": none). The refusal and its rule are unchanged.

## Checked
Every root test that loads engine/projects.js (189 files, 2658 tests) with the change: 4 fail, and the same 4 fail on
main without it (control run on this Mac: server.test.js #1304, web.desc-error-1303g, web.inline-errors-2606,
web.project-page), so they are this machine's, not this change's. CI is the clean run.

## Review round 1 (sonnet, blind): nothing above NIT. Converged.
- The sentence reaches a person through the /api/project-folder preview (capitalised, full stop: "A name starting
  with a dot can make a hidden folder, so pick another.") and as create's thrown message; nothing pins the old words.
- Checked, not this card: "Finder did not open" (engine/projects.js) is Mac-only, because Windows returns through
  win32explorer before it.
