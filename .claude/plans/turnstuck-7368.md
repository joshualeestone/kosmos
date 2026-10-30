# turnstuck-7368: a Windows Claude step that never ends is said on the card (kosmos#7368)

## Finished looks like
- On Windows, a message is written into the agent's input and counts as delivered even mid-turn, so a step that never ends silently holds later messages. When a Windows Claude agent has shown no activity for over an hour AND messages are queued behind its step, its card reads "Messages stuck" (the #7212 pill and issue edge, counted under Issue, the same word on the phone). Its page names the step and how many wait, and offers Restart or waiting.
- The board log says each stuck step once.
- A long step with nothing waiting behind it shows nothing new.

## Decided
- **Counting:** done on the supervisor (win32streamstate), measured on Claude Code 2.1.311 across reviews 2 to 5. A message written in while the main agent's tool calls run is taken when the LAST open call returns, or at the turn's result. Open calls are tracked by id. A subagent's calls (parent_tool_use_id) are not the main agent's.
- **Activity clock:** any assistant, user or system event while busy. It is written in 5-minute buckets, and that bucket is added to the hour. `tool_progress` (sent every 30 s during a hung command) is not activity.
- **No automatic kill.** Restart cannot redeliver: the messages sit inside the process it ends. So the words say they will need sending again, without assuming who sent them, and offer waiting.
- **Claude only.** Codex, Gemini and Grok run under other supervisors.
