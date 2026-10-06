# usagespin-5362: the standard spinner on loads over about a second

**Card:** kosmos#5362 (Josh 21:39 + 21:40: spinner on Token Usage; sweep other pages, measure on a real board, list on the card).

**Finished looks like:** Token Usage shows the Sweep spinner beside its reading line while /api/usage loads and never beside a result or an error; every page and panel load is measured on the real board and listed on the card; the speed cause is carded separately (#5363).

**Change:** web/index.html `#usage-msg` carries the spinner in its markup and on each paint (LOAD_SPIN_HTML); every later write is textContent, which removes it; the final line is built once (role=status reads it once). Browser check render-token-usage-2617 holds /api/usage to assert the spinner during, and its absence after success and after a 500.

**Measured (card comment):** only Token Usage is over ~1 s among loads a screen makes on open. /api/scan-agents is 5.5 s cold but no screen calls it on open (first run stopped scanning in #2497).

**Rejected:** a spinner on first run's "Looking for agents" screen (dead code since #2497; review 1); a spinner on the import scan's found-files list (not measured: reading Documents can raise a macOS permission prompt on the real board; the screen is not blank meanwhile).

**Weakest premise:** "over a second" was measured on one Mac (the fleet box), whose history is far larger than a typical person's; a smaller machine could only be faster for every route except usage, whose cost grows with history.

**Surface gate:** the token 'msg' changed (paintUsage's own local); render-unread-edge-3743 and render-agentdm-3414 assert chat bubbles (msg-b, msg-av, msg-bd...) and never read usage. Trailers on the commit; CI's browser-checks run both.
