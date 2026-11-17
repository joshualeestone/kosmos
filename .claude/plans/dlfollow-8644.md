# dlfollow-8644: the delete guard's leftover warnings (kosmos#8644, follow-up to #8640)

## Done (each with a test red when its fix is reverted)
- Item 3 (the one a person sees): settingsLeftovers (/api/removed) and namedRecords decided "running" by session name
  only. Both now read runningNames(): every session's name plus the agent each pane's launch claim names in this world,
  as plan() reads them. The list no longer names an agent running under another session name (its delete refused), and
  a profile shared with such an agent is kept. The folder check is not needed there: the list names agents with no
  folder.
- Item 1: #8640's second synchronous tmux read (pane folders) on the board's thread. status.paneFolders is one generator
  body with two drivers (paneFolders, paneFoldersAsync); planAsync reads the listing off-thread and hands it to plan()
  (opts.folders: the listing or the Error). Fail closed unchanged (Baron's ask).
- Item 2: one unreadable line refused every delete. A pane line split by a newline in its folder keeps its head with
  cut: true; plan() fails closed only when the agent's own folder begins with that head plus a newline (a folder named
  with a newline; a head already inside is the running case). Still refused for every agent: an unreadable line that
  starts a pane, a tail with no pane before it, and (review 1) a folder that is not an absolute path.

## Not done, with reasons
- Item 4 (Windows has no folder check): no Windows box here, and Windows engine work is not this fleet's build lane now.
- Item 5 (a session renamed without +world is dropped by readPanes): narrow; the folder check covers it while the pane
  works in the agent's folder. Left as stated in the code.
- Item 6: stated premises, already written in the code; nothing to change.
- Baron's ask: whether Put back (/restore) starts a second copy of an agent running outside Kosmos. Needs a launchd job
  on a real board; not measured here. Recorded on the card.

## Weakest premise
Item 2: that a newline is the only way a pane line splits. tmux escapes other control characters in formats; a tab in
a folder name stays inside the folder field (the regex takes the rest of the line).
