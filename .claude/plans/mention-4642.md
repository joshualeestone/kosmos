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
The rule lives in one engine function, `mentionedMembers(cleaned, recipients, roster)` (exported), called by
sendPostWithDelivery. An @ token after the existing left boundary names a member in three tiers, first hit wins:
1. the token is the member's session name exactly;
2. the token less a trailing run of . _ - is, exactly (the old retry);
3. its normalised form (NFKD, lower case, every non-alphanumeric dropped) equals the normalised session name or
   roster display name of exactly ONE recipient. Keys under two characters are ignored. A roster card for an
   agent not in the room adds no alias.

Two recipients sharing a normalised name are addressed by NEITHER. Promotion (a post read as a request) is the
direction the code is strict about, so an ambiguous mention demotes to background, which still arrives, marked.
An exact session name still wins over the ambiguity (tier 1).

The page mirrors it: `pjMentionResolve(word, keys)` in web/index.html is the one rule for the live composer
highlight, the posted-message highlight and Reply's "already named" check. `pjMentionKeys` now returns a Map of
key -> display name. Tier 3 on the page only applies to a word inside the engine's token charset, so the page
never paints blue a mention the engine would not deliver.

## Tests
- engine/messages.mention-4642.test.js (all roots sandboxed), through the real sendPost:
  - new behaviour, red on main: @Kano/@KANO -> kano; @Sub-Zero -> subzero by display name; @sub_zero, @SUBZERO.
  - controls: a plain word addresses nobody; @kanobot / @subzerox address nobody; an email-shaped string and an
    unknown @name address nobody; @mara still addresses mara; two members sharing a normalised name are
    addressed by neither (exact still wins); an out-of-room roster card adds no alias; a one-letter display
    name addresses nobody.
- web.mention-live.test.js: the same cases on the page highlighter, plus the charset limit. The old pin
  "@Mona stays plain" is replaced: that case-sensitivity is exactly what #4642 changes.
- web.mention-parity-4642.test.js: one fixture set through the engine's mentionedMembers and the page's
  highlighter, asserting they name the same agents, in a plain room and a room with a normalised-name clash.
- docs/browser-checks/render-mention-blue-2922.js: the live == posted differential gains a Map arm.
- Mutations, run by hand (each restored after): ambiguity -> first match, dropping the roster room filter,
  dropping the two-character floor, prefix matching and an optional @ each turn a control red on the engine;
  ambiguity, the charset limit, the floor and prefix matching each turn a control red on the page; ambiguity and
  a truncated key each turn the parity test red.

## Weakest part
- `@Liu` does not address liukang, and `@Johnny` does not address johnnycage: a display name with a space
  ("Liu Kang") is reachable only as `@LiuKang`. First words are deliberately not aliases (prefix matching is the
  dangerous direction). Of the 10 measured misses, 8 are fixed by this (@Kano 3, @Sub-Zero 3, @Scorpion 1, and
  @Sonya only if the display name is "Sonya").
- The page's display name comes from /api/projects (`a.name`), the engine's from the roster card (`card.name`).
  If those two sources ever disagree, the blue and the delivery disagree for that agent.
- Known, unchanged tokenizer gap (#2922 review): `@mona's` addresses mona in the engine but is not painted on
  the page. Safe direction; the parity test's fixtures stay inside whitespace-separated tokens for that reason.

## What would change my mind
A ruling that first names should address (then it needs an explicit, unique-in-room first-word alias, not a
prefix match), or that an ambiguous mention should reach both.
