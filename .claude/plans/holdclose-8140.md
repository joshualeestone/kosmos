# holdclose-8140: #8140 item 3

Call (on #8140): a hold's reason, a checkable condition, the met notice and the stale notice already exist
(#7749, #7180, #6209, #7151). The gap: both notices offer only "take it off hold" or "say why it stays",
never "close it if it no longer needs doing".

Change: engine/holdstale.js closeText(), used by tellText and metText. Own hold on a task the owner alone
holds: the exact `kosmos task close <id> <n>`. The person's hold, a hold for the person, or a task other
agents hold open parts of (`shared`, set in owed()): ask the person whether to close it, no command.

Tests: engine/holdstale.test.js, two pinned lines updated, two new tests (wording arms on both lines,
several tasks, unsafe id; owed() shared flag with a solo control and a done-part arm). Mutations of the
shared check, both closeText call sites and the shared flag each turn a test red.
