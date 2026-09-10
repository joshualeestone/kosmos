# Plan: allow a period in an agent name so titles work (#2605)

## The ask (Josh, 2026-09-09)
"To allow periods and titles if possible." The Create Agent name field blocked
"Dr. Maya Okafor" (and would block any title with a period). Josh: "This one is
blocking me from making this agent's name Doctor. I couldn't figure out what the
heck was going on."

## Current state (before this change)
- The name field is already a free-form DISPLAY name: capitals and spaces work
  (#740). "Kira Knightley" shows as typed and is `kira-knightley` to the machine.
- `engine/create.slugFor(raw)` = `cleanName(raw).toLowerCase().replace(/\s+/g,'-')`
  folds a whitespace run to one hyphen. A PERIOD is left in, so `nameProblem`'s
  `NAME_RE` (`/^[a-z0-9][a-z0-9_-]{1,31}$/`) rejects it. That is the only reason
  a title was blocked.

## The change
`slugFor` folds a run of whitespace OR periods to ONE hyphen:
`.replace(/[\s.]+/g, '-')`. Properties:
- **No-op for any period-free name.** `[\s.]+` matches exactly what `\s+` did
  when there is no period, so the entire blast radius is the period.
- **REPLACE, not strip.** This is the anti-collision invariant (create.js:456).
  Stripping would make `Ca.sey` -> `casey`, silently colliding with a real agent.
  Folding to a hyphen keeps it DISTINCT: `Ca.sey` -> `ca-sey` != `casey`. And a
  hard collision with an existing machine name is still refused by name at
  createAgent, never merged.
- **Leading period still refused.** It folds to a leading hyphen, which NAME_RE
  rejects, so a name still starts with an alphanumeric (`.Net` is refused, not
  turned into `net`). Trailing period is accepted (`Maya Jr.` -> `maya-jr-`,
  valid; slug slightly cosmetic, functional).

## Security analysis (load-bearing)
The display name is written into the agent's boot instruction file, "the most
powerful write in the product." create.test.js's "differ ONLY in case" test is
the injection guard: it asserts an accepted display name matches
`/^[A-Za-z0-9][A-Za-z0-9 _-]*$/` (no periods). This change widens that guard by
EXACTLY the period and nothing else.

Why the period is safe there, traced end to end:
- The name reaches the boot file only as a literal replacement into markdown
  prose: `roles.instructionsFor` does
  `role.instructions.split('{{NAME}}').join(name)` into `You are **{{NAME}}**, a
  role.` No regex interpretation, no YAML frontmatter, no shell. A period cannot
  break the bold, open a heading/list/code-fence, or run anything.
- displayName's only sinks: the markdown boot file, the profile JSON
  (JSON.stringify), and HTML-escaped UI. None is a shell/exec context.
- Every shell/launchd/tmux/directory surface uses the period-free SLUG
  (`plistFor(clean, ...)`), never the display name.
- Every OTHER character in the guard's dangerous alphabet still survives slugFor
  unchanged and fails NAME_RE, so it never reaches the display name. Only the
  period joins whitespace in the fold set.
- Round-trip: `readIdentity` prefers `profile.displayName` (exact); the fallback
  parse `You are \*\*([^*]+)\*\*` captures a period fine.

## Test changes
- `create.test.js`: `My.Bot` moves from the refused list to the accepted list; a
  leading-period `.bot` takes its place as the still-refused case. The #740 test
  flips `Kira.Knightley` from refused to accepted and pins the anti-collision
  (`Ca.sey` -> `ca-sey`, `!= Casey`), the title (`Dr. Maya Okafor` ->
  `dr-maya-okafor`), and the leading-period refusal. The injection-guard test's
  slug formula gains `[\s.]+` and its alphabet gains the period, both documented.
  The "length problem" test swaps its `has.dot` character-problem example for
  `has,comma` (a comma still fails NAME_RE).
- `server.test.js`: the CSRF control name that must be "refused by the engine"
  changes from `BAD.NAME` (now valid) to `BAD,NAME` (still refused), keeping the
  400 that proves the request reached the route.

## Out of scope
- Inline error display / red-stroke on the Create forms is #2606 (separate PR).
- Making the default account removable (re-homing symlinked history) is parked on
  Josh's word (data-loss stakes).

## Validation
Full node suite green: 5549 tests, 5549 pass, 0 fail. Engine + test only, no
`web/index.html` change, so no browser-check gate applies.
