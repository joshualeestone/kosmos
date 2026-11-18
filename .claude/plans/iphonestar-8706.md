# iphonestar-8706: the iPhone's starred star matches the board after #8705

Card: kosmos#8706 (Splinter handed it 11:52 CST 11-18). Board half: #8705, Mona Lisa, branch goldstar-8705.

## Finished means
On the iPhone, a starred star (Agents row, chat header) is the bright gold (#e3b341) with no outline in light and dark.
The deep gold edge (starGold, #9c741b light) appears only under Increase Contrast, as the board's only under
prefers-contrast: more. A press that stars an agent plays a small burst on its star, matching the board's: a 1.3x pop
over about .42 s, and six gold sparks flying out to the board's offsets over .55 s. Never under Reduce Motion. Shown in
light and dark simulator shots; served build checked once it ships.

## Design calls (card item 2 left the iPhone burst to the builder)
- Where it plays: the chat header's star is a real tap on the star, so it bursts there. The Agents row stars from a swipe
  or long press, so the row's star bursts as it appears after that press. Both read one value, BoardClient.burst(for:).
- What triggers it: only a press on this phone that STARS (set as the press starts, as the board plays on the press).
  A star read from the board, an unstar, or a star view first drawn more than 0.3 s after the press never bursts; a star that did not save clears it.
- Rejected: bursting whenever a star appears (onChange of starred). A star set on another device and read in by a
  re-sort would then burst too, which the board does not do.
- Rejected: a haptic with the burst. The swipe already clicks (Haptics.snapped), and Josh asked for a visual moment.

## Changes
- BoardClient: StarBurst { session, id, at }, set in toggleStar on a star, cleared on a failed save and on a computer
  switch (forgetChats); burst(for:now:) answers the id within starBurstWindow (0.3 s: the star is drawn at the press, and a view rebuilt later in the save must not replay the burst).
- AgentsView: StarredStar draws star.fill in starFill only; the starGold outline only when colorSchemeContrast is
  .increased; the burst (scale + six sparks) when burst changes to a new id and Reduce Motion is off. AgentRow passes
  starBurst; ChatView's header passes client.burst(for:).
- ChatView: the header star blocks a second tap with allowsHitTesting, not .disabled (which dims it mid-burst); VoiceOver
  hears "Saving" where it heard "dimmed".
- Tests: LogicTests main.swift (burst set for the starred agent only, gone after the window, on unstar, and on a failed
  save); room/main.swift's source checks updated from the outline to the new shape.

## Weakest premise
That the row's and header's star views are first drawn within 0.3 s of the press. Reasoned from showStars, which
re-sorts in the same call as the press; not yet seen on a device. A view rebuilt inside that 0.3 s replays the burst from
its start (bounded, not prevented).
