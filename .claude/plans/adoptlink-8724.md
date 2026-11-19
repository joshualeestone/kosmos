# adoptlink-8724: `kosmos adopt` offers the board link (kosmos#8724 item 2)

Card: kosmos#8724 item 2 ("`kosmos adopt` re-binding"). Stacked on reclaim-8719 (#8719 part 2, PR #8732: the link
itself, engine/linkwindow.js). Independent of item 1 (branch linkjob-8724).

## Finished means
`kosmos adopt` no longer leaves a hand-started window at "skip zara -- not one of ours" with no way on. When the link
would accept that window, the skip line names the command that links it. `kosmos adopt --link <name>` says what
linking means and changes nothing; `kosmos adopt --link <name> --confirm` links that one window through the same
engine and checks as the board's button. It then says what linking gives now (messages typed in, the conversation
shown) and what waits: the agent speaks as itself and can be restarted from the board only once Kosmos starts it (a
running window keeps the environment it was started with), and to run `kosmos adopt` to see what it would record now.
It does not promise adopt will take it: an agent adopted before is skipped for its provenance, and two sessions under
one board name can leave the roster's chosen pane unmarked. The preview carries the board dialog's caveat (the board
cannot restart it, its own kosmos commands do not yet speak for it) before consent, as the dialog does. Names are echoed as the engine read
them (trimmed). Proven by CLI tests against
stand-in engine modules, with perturbation controls.

## How
- install/kosmos `cmd_adopt`: arguments parsed in a loop (`--confirm`, `--link <name>`, either order). A missing or
  flag-shaped name, a second `--link`, or an unknown flag is refused with the usage line before anything is read.
- engine/linkwindow.js is loaded only where it is used, guarded: a link module that cannot load never stops the
  adoption review (its skip lines are then as before), and `--link` says this Kosmos cannot link windows.
- With `--link`: read the window list once (`status.panesWithCommands`, the board's own look); without `--confirm`
  run `linkwindow.plan` and print what linking means, or its refusal (exit 1); with `--confirm` run
  `linkwindow.link(name, { panes })` and print linked, or its refusal (exit 1). A plan or link that throws is said in a
  sentence (exit 1), as the board route does. The one refusal after which the mark may still be on the window
  (could not confirm it, and could not take the mark off) exits 3, "may have gone through": linkwindow now says that
  as a field (`markLeft: true`), so the CLI keys on it rather than on the sentence. A window list that cannot be read stops with 1 too
  (not done), as every other "could not look" in --link does; review rounds 1, 4, 5 and 6 each raised the 2 it had first.
- Without `--link`: the review is unchanged, except a skipped row whose reason is "not one of ours" and which
  `linkwindow.plan` accepts gets "; if you started it yourself, you can link it (kosmos adopt --link <name>), then run
  kosmos adopt again" (no promise adopt then takes it). A name that is not plain is printed in single quotes (a quote inside closed,
  escaped and reopened), so nothing in it expands when pasted. The window
  list is read once; if it cannot be read the skip lines are exactly as before.

## Decided
- Two steps (`--link`, then `--link --confirm`), matching adopt's own "nothing is written without --confirm" and the
  board's confirmation dialog. Rejected: linking from plain `adopt --confirm` for every linkable window (a vouch the
  person never made, per window, for windows they may not have started).
- Linking and adopting stay separate commands. Adoption mints a credential and records provenance (Josh's 2026-08-27
  ruling, engine/adopt.js); linking only sets the window mark. Rejected: doing both in one step (it would blur the
  record of what was vouched for).
- The engine is linkwindow's, unchanged; its checks (Claude window named exactly for the agent, alone in its session,
  not marked) and its refusal sentences are the board's.
- `kosmos adopt --help` still re-dispatches a bare review, so --help never links.

## Weakest premise
That `status.panesWithCommands()` and `status.boardTmux()` resolve the same tmux from the CLI's process as from the
board's. Both read the same repick (status.js tmuxRepick); not measured from the CLI against a live second tmux here.

## Tests
- cli.adopt-link-8724.test.js (12; markLeft exits 3; a name with $, backticks and a quote pastes back through a real sh; a quoted name in the printed command; --link with an unreadable window list; no window look when nothing is skipped as not ours; stand-ins log every read and return the real shapes): hint only for a linkable skip (control: an unlinkable one stays plain); an unreadable
  list leaves skips as before; --link alone changes nothing; --link --confirm links in either order; a refused link
  says the engine reason and exits 1; a throwing link is a sentence, not a stack; a link module that cannot load
  leaves the review as it was; bad arguments (including a second --link) refused before the roster or windows are
  read. Perturbations: hint off (1 red); --link
  acting without --confirm (1 red).
- cli.adopt-link-real-8724.test.js (2): this branch's real status.js, adopt.js and linkwindow.js through the real CLI,
  with test-support/fake-tmux.sh answering reads and every data root in a temp folder: the hint for a lone unmarked
  Claude window and none for one sharing its session (so the roster row and the link check meet on one name); --link
  previews one and refuses the other with the engine's reason.
- Every test that reads install/kosmos (177 files).
