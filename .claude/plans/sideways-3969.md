# #3969: the agent chat on a phone held sideways (#718)

## Finished looks like
At 640x360, 667x375, 852x393 and 932x430 (phones held sideways), light and dark, the conversation has room
and the message box and Post are on screen; portrait is unchanged; a browser check proves it and fails on main.

## Built (continued from Scorpion's WIP branch sideways-chat-3969, his commits kept)
- The chat-first phone query (CSS and the matching matchMedia) also covers a short sideways touchscreen:
  (hover: none) and (orientation: landscape) and (max-height: 30rem) and (max-width: 56rem).
- Sideways only, in the chat: the All agents link, the header avatar, and an EMPTY, unfocused search box step
  aside. 932x430 is past 56rem and keeps the side-by-side layout, which already fits (measured).
- 44px chat search and message box targets (#718 re-sweep).

## Decided
- Searching the chat is not available sideways (the empty box is hidden); upright brings it back. A search
  button is a possible follow-up. A search already filtering stays on screen with its clear button.
- The back link's one-tap return to a project is lost sideways; the Projects tab is the way back. Keeping it
  costs about 44px of a 57 to 90px conversation.
- render-signin-visible-3892's sideways arm now uses a tied swarm agent (swarm cards are always tied); its
  untied fixture's extra note is a state a swarm agent never has.
- Weakest premise: Playwright touch emulation stands in for real phones; not checked on a device.
