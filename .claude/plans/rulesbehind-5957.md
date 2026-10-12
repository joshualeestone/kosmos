# #5957 slice 2: an agent whose working rules are far behind says so on its card

**Branch:** `rulesbehind-5957` · **Card:** kosmos#5957 (slice 2 of 3; slice 1 is dupname-5957, slice 3 the archive offer).

## The defect
Josh's Windows QA (10-12): a stale "Gemini" had working rules v15 against a current v28 and no community section, and
nothing on the board said so. The agent's own page has the update note (#539, `d-doctrine-note`) and Settings has the
fleet dialog, but both need the person to go looking; the card, where an agent is seen, says nothing.

## The rule
A card says it when the agent is FAR behind: its recorded rules version (`profile.doctrineVersion`) is at least
`RULES_FAR_BEHIND` (5) versions below the current one (`DOCTRINE_VERSION`), AND the agent's own page would offer the
update (doctrine.status says `refresh`, not `current`). The second condition keeps the card and the page agreeing: a
person who edited the rules by hand reads `current` there, and the card must not send them to an update the page will
not offer.

## Where it is computed
`doctrine.status` reads and plans the whole instructions file, too heavy for every card on every poll. So the server
computes `rulesBehind` (a number, or null) per tied row, CACHED on (instructions file mtime and size, profile
updatedAt): the cost is one stat per poll unless something changed. Null when the version is unknown (an agent made
before the version was recorded) or the file is missing: no claim from a missing record.

## What the card says
Through `stateReason`, as the last rule (anything more urgent wins): "Its working rules are N versions behind. Open it
to update them." Plain words, no new badge or colour: the card's look is unchanged (the same posture as #5154 slice C).

## Not in this slice
A Settings list of every agent's rules version, last run and summary freshness (the card's last sentence) is a later
slice; this one makes the far-behind agent visible where agents are seen.

## Tests (planned)
- engine: the cache answers the same as doctrine.status, and recomputes after the file or profile changes; null for an
  unknown version.
- page (lifted stateReason): the sentence for behind >= 5 and `refresh`; nothing for 4 behind, for `current`, or when a
  more urgent reason applies.
- Mutants: threshold off by one; the refresh condition dropped; the cache never invalidating.
