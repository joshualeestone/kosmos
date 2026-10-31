# kosmos#7212 slice 1: a held delivery is never silent and never called a usage limit

## Problem
A person's agent sat seven days with messages held behind its input box. The card read Idle, the stuck-input
sweep (#6717) logged nothing, and the board log said the held messages were given "after its usage reset".

## Slice 1 (this branch): the engine says the true thing
1. limitqueue: `heldWhy` (input / signin / behind / limit) travels on each flush result, and `deliveredLine` names it.
2. limitqueue `heldInputToSay`: an agent with messages held 30 min behind its input box is said once per held stretch,
   and again each day it lasts. A stretch ends only on a good read with nothing input-held (a read glitch ends nothing).
3. server.js minute sweep: says those lines after the flush settles, never while a run is typing (`isFlushing`), with
   what the box reads (`chat.inputBoxReads`: text / empty / unread).
4. stuckinput: says once why it keeps waiting after 30 min; nothing when the box has emptied; errors by kind only.

## Not in this slice
- Slice 2: a board notice and card line after 30 min held, with one press to clear or restart (page work, design shots).
- Why the stuck-input sweep never acted on the card's case (it only sees idle Claude cards with unsentInput, after the
  live opt-in). Card question 3, for slice 2.
- A DM kept behind others while signed out is stored without `signin` (server.js DM path), so it logs as a usage
  reset. Changing it changes what is typed to the agent; left for its own change.

## Untested, said in the PR
- The server.js wiring (line wording, `.finally` order, the no-names branch) has no direct test.
- `chat.inputBoxReads` needs a tmux pane; no direct test.
