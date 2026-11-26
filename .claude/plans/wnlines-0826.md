# What's New pool: lines for #9093 and #9094 (both shipped in 0.8.25 without one), and two carried lines made accurate

release/whats-new-pool.json only (data; nothing a person sees until a cut builds the window):
- "A refused download offers a restart" (mac, rank 10, since 0.8.25): #9093, PR #9129. Mac only: the change is in native-app/main.swift.
- "The agent list stops redrawing itself" (all, rank 10.5, since 0.8.25): #9094, PR #9128.
- Ranked above the top pending item (12) because Josh reported both.
- Carried "A closed question says who closed it": for UP TO 12 hours, only while the agent is idle or working, and "what ended it" (Baron, #9131 review 5; the causes include events, not only people).
- Held #9097 "Windows warns before a Claude login ends": the warning is a notice to the person, not something the agent gets (Baron).
Checked: `whats-new-pool.js build 0.8.26 --offline` takes both new lines into the window (titles <= 48, lines <= 140; the first title, 51 characters, was refused and shortened). 8 pool test files, 166 tests pass.
Left for whoever releases #9097: its platform tag (the expiry is read off macOS everywhere, so Linux may get it too); the line is held.
