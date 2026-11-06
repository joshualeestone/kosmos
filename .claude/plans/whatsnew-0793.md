# whatsnew-0793: What's New for the 0.7.93 staging cut

Data only: five new items in release/whats-new-pool.json (since 0.7.93), and web/whats-new.json rebuilt by
`node tools/whats-new-pool.js build 0.7.93` (prod still 0.7.91, so nothing is marked shown).

- Highlights: #8040 (Create agent says when no model is connected), #8039 (start a new agent without imported files),
  PR #8090 / card #7504 (Windows only: crash recovery not set up, said when start at sign-in is turned on).
- notesOnly: PR #8074 / card #8071 `kosmos agent restart`, #8048 `kosmos agent move`.
- Left out: #8068's mover hold (the automatic mover moves only with AGENT_WORKFORCE_AUTOMOVE=1, so no person meets it);
  #8052, #8054, #8058, #8078 (ios/ only, the iPhone app ships separately); #5536 (dark); #8067 and #8083 (an agent
  nudge and board-log wording).
- Decided: the Windows-only item (rank 15) takes the fifth slot, so a Mac window shows four. Rejected: ranking it
  below the rank-16 Mac items, which would leave Windows no line about its own change.
- A blind check read every line against the code: four true as written; the Windows line was overstated (it is said
  once, when the switch is turned on) and was rewritten in the reviewer's words. Review 1 then found #8039's
  "files your settings import" would send a person to the Settings screen (it is the agent's instructions), and
  #8040's "keeps what you typed" broader than the code (kept for 30 minutes, if you follow the link and come back).
