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
- Mutants: guideFailure without RATE_LIMITED -> reds "the Guide would stay silent". The marker-without-"you've" mutant reds on the one-line promo by name ONLY SINCE ROUND 3: from round 2 to round 3 every control lacked a column-0 footer, so limitMarkersFor dropped the marker and the controls could not fail (earlier version of this line claimed otherwise; corrected).
- engine/status*.test.js + engine/setup-assistant*.test.js: 502/502 at 826e44e27.
- Full suite: PENDING.

## Review
- Round 1 (opus, blind): BLOCKER taken: the marker was unanchored and outranks needs_you, so an agent ASKING "you've hit your GitHub API rate limit, wait?" read rate_limited (question hidden) and a healthy Guide explaining limits switched to the backup. Now /^[\s⎿]*You['’]ve hit your .{0,40}limit/ (case-sensitive), with ASKING (must be needs_you) and EXPLAINING controls; the unanchored mutant reds on ASKING by name. [CORRECTED round 5: false. That mutant was /hit your .../i, case-insensitive; a case-sensitive unanchored marker passed every test because ASKING/EXPLAINING say lowercase "you've". The anchor is pinned only since round 5, by CAPITAL_PROSE.] SHOULD-FIX 3 taken (the healthy-pane control could not fail; replaced). NIT 5 taken (note on why only messageAt strips ⎿).
  SHOULD-FIX 2 REJECTED: create.js CLAUDE_CAPACITY, see Decided (both outcomes of a miss allow the create; its input is unobserved). NIT 4 DEFERRED: on an unobserved modal shape with no row between, the evidence would carry "What do you want to do?" on; changing messageAt's sentence-end rule touches every evidence line.
  Residual, stated in the code: an indented second paragraph of agent prose opening with exactly "You've hit your ... limit" still matches.
- Round 2 (sonnet, blind): 0 BLOCKER. SHOULD-FIX taken: a healthy agent that CATS a capture prints the vendor row under ⎿, same shape. The marker now counts only with Claude Code's turn footer at column 0 within two rows (limitMarkersFor), observed on all four screens; a tool result's rows are indented. I first wrote "no ● row after it" and REJECTED it myself before testing: Irma's real capped pane has Claude Code's survey as a ● row after the limit. Arms: CATTED (healthy, footer copied indented) and WITH_SURVEY (capped). Mutants: no gating, and an indent-tolerant footer, both red on CATTED by name. NIT 2 taken (doc lists the residuals). NIT 3 (framed vendor line reads idle) recorded as a residual; unobserved. NIT 4 covered by CATTED.
- Round 3 (opus, blind): 0 BLOCKER. SF1 taken: since round 2 the PROMO/PROMO_ONE_LINE/ASKING/EXPLAINING controls could not fail (no footer -> marker dropped before the regex mattered). Each now carries a column-0 '✻ Worked for 4s · done 9:01 AM' row after its limit row. Measured 10:4x on 31c9d4982: mutant /hit your .{0,40}limit/i reds the test on the one-line promo by name; standalone, the mutant reads ASKING and EXPLAINING (with footer) rate_limited and ASKING without a footer needs_you (the old blind spot, shown); restored: needs_you / idle. SF2 taken: the doc's 'a tool result cannot have the footer' was false (a turn ending on a tool call puts the real footer at col 0 under it); comment corrected, listed as a third residual, no code change. NIT3 taken: load-time throw if HIT_YOUR_LIMIT is undefined.
- Round 4 (sonnet, blind): 0 BLOCKER. SF1 taken: TURN_FOOTER /^✻ \S.* for \d/ also matched a live, OBSERVED row on a healthy agent, "✻ Waiting for 1 background agent to finish" (the reviewer's spinner shape was unverified; the background-wait row is in this repo's own tests). Now /^✻ \S+ for \d[\dhms ]* · done \d/, the shape of every observed footer (4 captures + repo fixtures). [CORRECTED round 5: false for the fixtures. status.pane-states-1889 has '✻ Cooked for 12s' and status.test.js '✻ Worked for 3m 12s', neither with '· done'; the 4 live captures all had it. Round 5 drops the clock requirement.] SF2 taken: controls EARLIER_FOOTER, LATER_FOOTER (4 rows), BACKGROUND_WAIT; NIT1 taken: LOWERCASE control. NIT2 (wrapped /usage-credits loses the reset time from evidence) recorded as a residual in the doc; -J prevents it. Measured 10:35 on a scratch copy: M1 footer-anywhere, M2 window 30, M3 /i, M4 /^✻ /, and the old footer regex each red by name on their own arm. 238/238 (status + pane-states-1889).
- Round 5 (opus, blind; read Claude Code 2.1.287's own footer render code): 0 BLOCKER.
  SF1 taken: the footer is "✻ <Verb> for <dur>" with " · done <clock>" OPTIONAL; requiring it left a capped pane with a clockless footer idle. TURN_FOOTER now /^✻ (?:\S+ for \d[\dhms ]*(?: · |\s*$)|Waiting for \d+ .* to finish)/. showTurnDuration OFF (no footer at all) recorded as a residual.
  SF3 taken, REVERSING round 4's exclusion of the waiting row: the vendor draws "✻ Waiting for N background agent(s) to finish" in the SAME footer slot, so excluding it hid a capped agent with a pending background agent. Accepting it adds no new false positive (a healthy agent gets a column-0 row under a tool result only at turn end = the existing residual). The ✻ mid-turn spinner is what must be refused; SPINNER control (spinner text observed in repo fixtures, with the ✻ frame).
  SF2 taken: CAPITAL_PROSE pins the anchor.
  N2 taken (curly ’ marked ASSUMED in the doc). Not taken: N1 (require " · " in the vendor row: would close the indented-prose residual but drops unobserved reset-less variants; residual stays listed), N3 (evidence uses the ungated list; differs only with an ungated row above a /usage-credits row), N5 (non-digit locale clock; unobserved). N4 (vendor strings "You've hit your team's shared budget", "You're out of usage credits", from the binary, never seen live): separate card, not a marker today (rule: markers from observed screens).
  Measured 10:47 on a scratch copy, each red BY NAME on its own arm: /^✻ / -> SPINNER; round-4 regex (needs done) -> no-clock arm reads idle; no waiting alternative -> waiting arm reads working; old /^✻ \S.* for \d/ -> SPINNER; unanchored case-sensitive marker -> CAPITAL_PROSE; window 30 -> LATER_FOOTER; footer anywhere -> EARLIER_FOOTER. Straight-apostrophe-only survives (’ is assumed, said so). 238/238.
- Round 6: PENDING.
