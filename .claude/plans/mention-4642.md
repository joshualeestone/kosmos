# mention-4642: a room post addresses a member by display name too (kosmos#4642)

Found while measuring #4580 item 9 (Liu Kang m3603). Ruled by Liu Kang (m3606): match an @mention against the
agent's session name AND its display name, case-insensitive, ignoring punctuation (@Sub-Zero -> subzero), only
in the @ form; a plain word must not count, and @kanobot must not match kano.

## Measured before the change
- engine/messages.js (the `mentioned` set in sendPostWithDelivery) addressed a member only on an exact,
  case-sensitive session name. On this board's messages.jsonl, 09-23 to 09-29: 43 room posts, 258 arrivals, 0
  recognised as addressed; 10 were meant for the agent they reached (@Kano 3, @Sub-Zero 3, @Scorpion, @Johnny,
  @Liu, @Sonya) and arrived marked "not addressed to you".
- #4624 (PigeonPete) holds background posts for a working agent. With it, those requests would wait, so this
  should land first or together (said on #4624).

## Change
One lookup table per post: every recipient's session name and, from the roster card, its display name (`name`),
both normalised (lowercase, letters and digits only). An @ token after the existing left boundary is normalised
the same way and looked up. Two recipients sharing a normalised name are both addressed (the safe direction).

## Tests (engine/messages.mention-4642.test.js, all roots sandboxed)
- New behaviour, red on main: @Kano/@KANO -> kano; @Sub-Zero -> subzero by display name; @sub_zero, @SUBZERO.
- Controls, green on main and here: a plain word addresses nobody; @kanobot / @subzerox address nobody; an
  email-shaped string and an unknown @name address nobody; @mara still addresses mara.
- Mutations: prefix matching turns the @kanobot control red; an optional @ turns the plain-word control red.
- Existing: messages.test.js 104/104 and every room/post file (server.post-*, cli.post-*, which-room, room-clock,
  room-reopen) green.

## Weakest part
A display name that normalises to another member's session name (a member displayed as "Kano" who is not kano)
addresses both. That is the safe direction, but it would read as a request to both. `@Liu` does not address
liukang (display name "Liu Kang" normalises to "liukang"): first words are deliberately not aliases.
