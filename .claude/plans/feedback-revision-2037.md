# Plan: revise the daily product-feedback report (kosmos#2037)

Josh reworked the daily product-feedback report (2026-09-05), routed via Splinter.

## The call

Two changes, mechanism otherwise unchanged (the PM writes one note per local day,
`kosmos feedback write` + `show` self-check, PM-scoped).

1. **Content -> a 3-question structured prompt** (engine/roles.js, the PM role's
   "Once a day" block). Not a free-form work write-up:
   1. What bugs did you hit today, or what did your user ask for that is not wired up?
   2. Is anything broken?
   3. What would make the app better, technically or for the people using it?
   Plus an **explicit in-prompt rule**: "Do not share usernames, agent names, or
   project names." De-identification is authored in.

2. **Scrub extended** (engine/feedbacksend.scrub()) beyond home paths to redact
   this install's identifying names as a **backstop**: every agent name (profile
   display name + on-disk key + worker-folder name), every project name, and the
   OS account name. Unicode-aware word boundaries, case-insensitive, longest-first,
   min length 4, stoplist {'kosmos'} (the product is the report's subject).

The **prompt rule is the primary defence**; the scrub is the belt. The report is
POSTed off the machine, so the scrub is privacy-critical.

## What I rejected / decided

- **PM-scoped, not fleet-wide.** Josh's recorded #2037 design says a single
  designated author (the PM) writes the report; a test enforces non-PM roles do
  not carry it, and one file/day means multiple authors would clobber. Splinter's
  "prompts each agent daily" reads fleet-wide; I flagged it and kept PM-scoped.
  Splinter confirmed (keep PM-scoped now; fleet-wide is a separate follow-up
  widening that would rework the single-author guard, and my content+scrub+rule
  work applies either way). Josh confirms the scope when back.
- **`\b` -> Unicode lookarounds.** `\b` fires only at ASCII word chars, so a
  Cyrillic/CJK/accented name or one bordered by punctuation ("C++", ".env")
  slipped both edges and leaked. `(?<![\p{L}\p{N}_]) ... (?![\p{L}\p{N}_])` + `u`
  matches a name in any script, whole, never inside a longer word.
- **No live tmux roster in the scrub.** A send path must never depend on tmux, so
  agent enumeration is on-disk only (profiles + worker folders). A pure-tmux agent
  Kosmos never created or connected relies on the prompt rule.
- **MINLEN=4 + whole-name matching, kept.** Lowering to 3 or redacting per word
  would gut common words ("the", "app", "web", or "Cream" out of "Ice Cream
  Kitty"). Short names and reformatted multi-word mentions are the documented
  residual the prompt rule covers.
- **Over-redaction is the safe direction.** A project literally named "email" is
  redacted everywhere it appears; matching the path arms' existing choice and
  Josh's "zero identifying info" framing. Rare in practice because the prompt rule
  keeps names out of the body.

## Weakest premise

The backstop's completeness depends on the identifying names being enumerable
on-disk (profiles / worker folders / projects) and >= 4 chars. A short name, a
never-profiled pure-tmux agent, or a reformatted multi-word mention can survive
the scrub - which is why the prompt rule is the primary defence, not the scrub.

## Verification

- feedbacksend.test.js: agent/project/account redaction, min-length bound, kosmos
  stoplist, word-boundary safety, Unicode/punctuation-bordered names, regex-
  metacharacter escaping, throw-safety past a malformed profile, worker-folder-only
  agent, fail-soft on a damaged projects file. Tests reset profiles/projects/workers
  and sandbox AGENT_WORKFORCE_WORKERS so a name from one test cannot leak into
  another.
- roles.feedback-2037b.test.js: the 3 questions + the explicit rule, keeping the
  write/show + PM-scoped asserts.
- Full node suite (deferred behind Baron's 0.6.37 release machine-claim; run as the
  final gate once the box frees) + challenge-loop.

## Follow-ups (not this PR)

- Fleet-wide vs PM-scoped: pending Josh's confirmation (Splinter tracking).
- Kitty's #2295 scrub-verify (home-paths-only) re-verifies the extended scrub on
  the 0.6.37 cut.
