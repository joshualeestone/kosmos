# whatsnew-0793: What's New for the 0.7.93 staging cut

Data only: five new items in release/whats-new-pool.json (since 0.7.93), and web/whats-new.json rebuilt by
`node tools/whats-new-pool.js build 0.7.93` (prod still 0.7.91, so nothing is marked shown).

- Highlights: #8040 (Create agent says when no model is connected), #8039 (start a new agent without imported files),
  #8090 (Windows only: crash recovery not set up, said when start at sign-in is turned on).
- notesOnly: #8074 `kosmos agent restart`, #8048 `kosmos agent move`.
- Left out: #8068's mover hold (the automatic mover moves only with AGENT_WORKFORCE_AUTOMOVE=1, so no person meets it).
- A blind check read every line against the code: four true as written; the Windows line was overstated (it is said
  once, when the switch is turned on) and was rewritten in the reviewer's words.
