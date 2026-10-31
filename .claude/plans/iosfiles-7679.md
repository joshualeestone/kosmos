# iosfiles-7679: an agent's and a project's Files on the iPhone, like the desktop board (kosmos#7679)

Josh 10-31 09:14: "I feel like we need to add the files to the agents and projects".

## Shape
- Agent page: the Profile tab ends with the agent's newest files and View All, as the board's agent panel. It follows
  the board's paintAgentFiles rule (#3757, Josh 0.6.94): no section while it loads, on a 404, or with no files.
- View All opens a folder browser over /files/browse: folders first, then files, one level per screen.
- Project: a Files button in the room's top bar opens /documents?limit=500, as the board's Documents view.
- A file opens through the chat's fetchFile in Quick Look, whose share button is the share sheet. A page or markup file
  opens on the board. A file past 100 MB is not fetched. After Quick Look closes, the copy is removed from the phone.
- No server change: every route used is reachable through the relay.

## Proof
ios/LogicTests/run-files.sh (48 checks, in iOS CI now): request building and encoding (+ & = # %, dots), path safety,
decoding of every route shape, the section rule, sizes and dates, and the board's own words checked against
web/index.html. A broken copy of the logic turns it red. The agent page, room and main suites pass too.

## Not proven here
The views compile only in iOS CI on the pushed head (a local simulator build passed while the code was mid-review).
Simulator shots and a real device follow; the card goes to needs-device after the shots.
