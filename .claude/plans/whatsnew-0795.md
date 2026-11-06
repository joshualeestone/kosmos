# whatsnew-0795: What's New for the 0.7.95 staging cut

Data only: five new items in release/whats-new-pool.json (since 0.7.95), and web/whats-new.json rebuilt by
`node tools/whats-new-pool.js build 0.7.95`. Prod is still 0.7.93, so 0.7.94's three items stay eligible beside these.

- #7896 (Josh 11-03, 11-06): the KOSMOS orb on whole-screen waits (Opening, Updating, Kosmos+ sign-in), and making an
  agent ends with the dots becoming a check. Ranked first: Josh asked for it.
- #5167: the Mac app says why when a download cannot be created (Mac-only).
- #8111 / #1765: on Windows, the board says when it runs from a folder others on the PC can change (Windows-only).
- notesOnly: #8109 kosmos agent remove takes the listed name; #8128 kosmos community status --limit.
- Left out: #8072 (iPhone app, ships separately), #7693 (a loop-held log line), #8113 (name resolution inside a guide).
