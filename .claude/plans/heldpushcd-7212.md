# kosmos#7212 slice 2c: the held-messages push keeps its own cooldown window

Slice 2b's push (engine/heldinput.js) shared phonenotify's per-agent needs_you window with a real question. A question
inside the window swallowed the held push, which is sent once per stretch and never retried; the reverse silenced a
question. The held push now says `held: true`, and routeFor gives it the class `needs_you_held`: same switch, same key,
same 5 minutes, its own window. The flag is routing only; payload() keeps its fixed fields.
