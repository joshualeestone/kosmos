# #4468 board CPU measurement

Finished means a 60-second CPU profile from a sandboxed board with 25 synthetic agents and realistic page, direct-message and room-post traffic, with request latency and the measured hot paths posted on #4468 before any fix is proposed.

Decision: profile a real `server.js` child with every writable root, HOME, tmux read and outbound integration redirected into a temporary sandbox. Use three simulated page tabs polling every five seconds, one staggered direct message per agent per minute, and six room posts per minute. The room has all 25 agents, so every post still exercises realistic fanout without assuming every agent posts once a minute.

Rejected: attaching to the live fleet board, because it risks the board Josh and the agents are using and would mix unrelated load into the evidence. Rejected: profiling only `snapshot()` in-process, because it would omit HTTP queuing, message and project work, and the real child-process boundary.

Weakest point: fake tmux has the same process-spawn boundary as production but much cheaper commands and identical screen output for every agent. The profile can identify board-side scaling and call counts, but not claim the exact CPU percentage of a real tmux fleet. A diagnostic arm with five tabs and 25 room posts a minute reproduced 7 to 17 second responses, but it was deliberately rejected as the baseline because the 25-member fanout made that post rate too aggressive.

What would change the call: if the isolated load cannot reproduce meaningful CPU or latency, separate 60-second scaling arms by agent count, message volume and tab count rather than increasing one mixed workload until it becomes artificial.

## Fix

Finished means the paste-to-Enter delay remains unchanged for every recipient, but an in-flight 25-recipient post no longer prevents `/api/status` from answering. Existing synchronous engine callers and their tests keep their contract; HTTP message and post routes use the asynchronous delivery path. The identical 60-second harness must show the before and after request latencies and CPU hot paths.

Decision: keep fanout sequential for this change. An asynchronous timer removes the event-loop freeze while preserving recipient order and the full safety gap. Parallel fanout is rejected unless the repeated profile shows that total post duration, rather than board responsiveness, is still the important cost.

Weakest point: the asynchronous and synchronous delivery paths now share all logic except the wait mechanism, but the public API has two entry points. The integration control covers the live HTTP path and would fail if it accidentally returned to the synchronous path. A future conversion of every internal caller to promises could remove that split, but it is larger than the measured bottleneck requires.
