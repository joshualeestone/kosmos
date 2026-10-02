# guidecap-5029: the Guide goes silent when its Claude account is at its limit (kosmos#5029)

Started 2026-10-02 10:23 CDT, Ice Cream Kitty. Josh priority.

## Observed (not guessed)
Splinter's captures of three capped panes, 2026-10-02 09:55 (~/.cache/claude-handoffs/capped-claude-pane-captures-20261002.txt):
`You've hit your weekly limit · resets Oct 5 at 12am (America/Chicago)`. Two add `/usage-credits to finish...`; one does not, and the modal menu does not.
RATE_LIMIT_MARKERS (engine/status.js) had only `reached your .{0,40}limit` and `/usage-credits`, so those panes read idle, setup-assistant.guideFailure
returned null, and the hosted fallback (#3660) never switched on. That is the silence.

## Change
1. Marker `/you['’]ve hit your .{0,40}limit/i` with its provenance paragraph. "you've" is required: the #966 promo says "If you hit your limit" on a healthy agent.
2. messageAt strips Claude Code's tool-output glyph `⎿`, so the evidence (and the card's because) starts at the vendor's words. ONLY messageAt; the other
   eight strip classes feed other matchers.
3. Test (engine/status.test.js, "#5029: ..."): three shapes -> rate_limited, evidence starts at the vendor line, guideFailure fires. Controls: wrapped promo,
   one-line promo (capture-pane -J joins it; the wrapped one could not fail), healthy pane.

## Decided, and why
- create.js CLAUDE_CAPACITY unchanged. Its input is `claude -p` output, never observed capped; every miss lands on UNKNOWN or CONNECTED (fail-open), never NONE.
  Adding a TUI-observed marker to a different surface breaks the observed-only rule. Changes my mind: a captured capped `claude -p` that reads NONE.
- No browser check. The bubble's switch and its words ("Your Claude account isn't answering right now, so I'm helping on Kosmos's backup. Add credits with
  Claude, or wait until the limit resets.") already exist (#3660, #3723). A browser check stubs the card state and passes on main; the guideFailure arm is
  the one that reds on main.
- Money half: ALREADY BUILT AND LIVE. Coordinator journal 2026-10-02: "setup assistant on limits=model claude-haiku-4-5 ... $50/month, $5/day; 30 a day per
  key, 150 per network"; assistant_spend shows real answers in late September. No design needed; the caps are the ones Josh set with #3660.
- No automatic key press on the modal. It wedges the Guide's own session until Esc; the backup answers meanwhile. Pressing keys in someone's terminal
  needs a design note first.

## Weakest premise
Three panes from one plan tier on one day. Another tier may word it differently; the marker allows any word before "limit" for that reason, but a wording
without "you've hit your" would still go silent.

## Found, out of scope (separate card)
While on the backup the bubble never messages the Guide, so its screen keeps the limit line after the reset, the card stays rate_limited, and the bubble
does not hand back until something else changes the screen (pre-existing for the 08-21 shape too). The backup stops at 30 a day per install.

## Validation
- Pre-fix commit 2d6b30a4b: the test reds on the no-credits arm (idle).
- Mutants: marker without "you've" -> reds on the one-line promo arm by name; guideFailure without RATE_LIMITED -> reds "the Guide would stay silent".
- engine/status*.test.js + engine/setup-assistant*.test.js: 502/502 at 826e44e27.
- Full suite: PENDING.

## Review
- Round 1: PENDING.
