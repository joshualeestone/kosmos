# didyoumean-9068: "did you mean" one level down, on both CLIs (#9068)

## Problem
#8948 part 2 suggests the nearest top-level command. One level down, `kosmos task|project|feedback|agent <typo>`
listed every subcommand with no nearest name, and `kosmos community <typo>` printed the long usage without saying the
word was unknown (two installs' feedback, 11-24).

## Change
- engine/didyoumean.js: an optional group. `suggest/line(word, verbs, listable, group)` answer `kosmos <group> <verb>`
  from the group's own subcommands; a plural gives the singular, never " list" (that is the top level's). The program
  form takes `--group <group> <word> <verb>...`. With no group nothing changes (#8948's tests unchanged).
- install/kosmos: `_unknown_sub <group> <word> <sep> <verb>...` prints the same "Unknown: kosmos <group> <word>. Try:"
  line each group printed (its separator kept: agent's commas), then the suggestion. Used by task, project, feedback,
  agent, and community; KOSMOS_COMMUNITY_VERBS names community's subcommands. `kosmos community <word>` (not a flag,
  not post) now says Unknown first, the list, the suggestion, and where the full usage is; a bare `kosmos community`
  (or a flag) keeps the full usage.
- tools/windows/kosmos-cli.js: `unknownSub` does the same from SUBCOMMAND_HANDLERS; subcommandRequired and
  verbCommunity call it.

## Decisions
- The same rule as #8948 (within two edits, one for a word under five letters, no tie), not a wider one: "shwo" for
  show gets no suggestion (a swap is two edits). Rejected: adding transpositions here; it would change the top level's
  answers too, and the card asks for the same suggestion one level down.
- Community keeps its long usage only for a bare command; an unknown word gets the short answer, which ends by naming
  `kosmos community` for the full usage.
Weakest premise: the second report ("one mistype suggested, another did not") is unspecific; it may be a group or a
case this does not cover.

## Tests
engine/didyoumean-groups-9068.test.js: the rule with a group; each group's Mac list equals the Windows CLI's
subcommands, and cmd_community's dispatch is all in KOSMOS_COMMUNITY_VERBS; both CLIs name the nearest subcommand in
every group, nothing for a far word, community's Unknown first, a bare community still the usage. Controls: with main's
module and Windows CLI the three behaviour tests fail; dropping `edit` from the list fails the coverage test.
Updated pins (the behaviour the card changes): tools.windows-kosmos-cli-570 (task reassign gains its suggestion),
-community-4330 (community publish says Unknown), cli.community-withdraw-5574 / -endorse-4913 / -vote-4884 (full help is
a bare `kosmos community`), and the verbs-parity test's parser reads `_unknown_sub`.
