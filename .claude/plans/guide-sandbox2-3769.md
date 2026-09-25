# guide-sandbox2-3769: close the gaps in Ice Cream Kitty's security review of #3769

(Built as branch guide-sandbox-3769 on top of the pre-merge #3769 branch; replayed onto main after #3777
merged, as guide-sandbox2-3769. Same changes: the two new modules are byte-identical.)

Card: kosmos#3769 (Josh 2026-09-25 11:54: the helper agent must never give out passwords or keys). Built on
branch guide-secrets-3769 (the three layers). Ice Cream Kitty's review (card comment, 12:20): merge that,
then close two gaps before 0.6.95. This branch is those gaps.

## 1. Deny rules name commands, not reads: sandboxed Bash
- Her finding, reproduced here: `node -e readFileSync` and `grep -r` read a denied file; the deny rules bind
  Claude Code's own tools, and a shell command is a subprocess they do not reach.
- `guardGuideFolder` turns on Claude Code's sandbox for the guide on macOS: `sandbox.enabled`,
  `autoAllowBashIfSandboxed`, `network.allowLocalBinding`. The sandbox applies the deny paths to every
  subprocess at the operating system.
- **Measured with real Claude Code runs on this Mac, each with a control:**
  - node read a denied file: `EPERM` with the sandbox, printed without it;
  - `grep -r` over the guide folder built by this branch's `guardGuideFolder`: "Operation not permitted" on
    the denied file with the sandbox, canary printed with the sandbox removed;
  - curl to a localhost board: fails with the sandbox alone, works with `allowLocalBinding`.
- The sandbox also keeps the `kosmos` command from reading the board token (it lives in the denied data
  folder), and `kosmos reply` presented only that token. **`kosmos reply` now presents the agent token**
  too, as `whoami`, `report` and the Windows CLI already do. Measured: a sandboxed Claude Code session ran
  the real `kosmos reply` against a stub board and it arrived with the agent token; the unfixed CLI under the
  same sandbox arrived with no credential, which an enforcing board refuses.
- macOS only: measured there; Kosmos also runs guides on Windows, where the sandbox is not the same thing.

## 2. The mask misses reformatted keys: mask by value, and a normalised copy
- `engine/knownsecrets.js` collects the keys the board holds: `board.token`, every file under `secrets/`
  (Cloudflare, GitHub, token doors), each account folder's key file (`.kosmos-claude-apikey`, Gemini, Grok)
  and Codex's `OPENAI_API_KEY` in `auth.json`. Loaded into the mask at board start and every five minutes.
- The mask replaces each held value, and its hex, base64 (padded or not) and base64url forms. Values under
  12 characters are ignored.
- Zero-width characters are stripped before matching.
- A normalised copy (a key rejoined across lines, a spaced-out key) is only searched: a held value or a key
  shape that exists only there, compared with whitespace set aside so a PEM block spanning lines is still
  the same key, withholds the whole message ("Kosmos removed a password or key from this message.").
- JWTs are masked whole (round 5 of #3769 noted the short middle part escaping).

## 3. Also closed
- The purpose the guide gives for an agent it makes (#3734) is masked in the team route before use.
- The Gemini and Grok key files are denied by name as well as by folder.

## Review round 1 (opus)
- `allowUnsandboxedCommands: false` was missing. **Measured: a refused command re-run with
  dangerouslyDisableSandbox read the denied file** (the canary printed); with the setting, the retry got
  "Operation not permitted" too. Fixed and tested.
- Withholding a whole message for a shape-only split damaged answers that explain key formats. Now the
  normalised copy keeps a map to the original characters, and a split key (held or shaped) is masked
  exactly where its pieces are, line break included; nothing is withheld whole.
- Held keys are also masked as upper-case hex and as spaced byte pairs, and across one blank line.
- At most 2000 held values are loaded (the review measured 545ms per reply at 20,000).
- Deliberately not done: the sandbox blocks the guide's shell from the internet and from writing outside
  its folder. The guide is hands-off (it shows people how, it does not install things), and `kosmos reply`
  keeps a reply in the outbox only when the board serves another Kosmos, which a guide never meets.
  Member names on the team route are not masked: a masked name would not be a usable agent name.

## Review round 2 (sonnet)
- No correctness issue: 40 split points each for held and shaped keys left no fragment; lists, tables, code
  blocks and wrapped URLs pass unchanged.
- Cost: ordinary lists and tables triggered the second scan (four times the cost). The line join now needs
  three key characters each side and a digit, "-" or "_" in them. My first version of that gate backtracked
  quadratically (37 s on a 200,000-character token, caught by the existing CPU test); it is anchored at the
  start of a run now (18 to 43 ms on the hostile inputs; a 40KB table with 2000 held values, 74 ms).

## Review round 3 (opus)
- BLOCKER, mine from round 2: the gate on the line join (digits or -/_ on a side, three characters each
  side) left split keys readable: a held all-letters value, an all-letters AWS key, a split one or two
  characters from either end. The gate is gone: every line break between key characters is joined (up to
  two blank lines). The cost is paid down instead: held forms are indexed by their first 8 characters and
  the text is scanned once, and the key shapes are searched in the joined copy only when it holds one of
  their openings. Measured: 0 of 820 split probes leak; a 40KB table with 2000 held values, 19 ms.
- Both are now permanent tests (every offset, five separators; a cost bound with a control).
- Left as a NIT: a split with three or more blank lines, or with a list dash after the break.

## Review round 4 (sonnet)
- No BLOCKER or SHOULD-FIX. The 8-character index cannot miss a held form (every form is 12 or more);
  shapeHint covers the opening of every entry in PATTERNS (traced by hand); both normalisedCopy regexes are
  linear.
- NITs, folded into the accepted note above: a numbered-list marker after a break ("\n1. ") breaks the
  join like a list dash does; shapeHint also fires on ordinary words such as "risk-free", which costs one
  bounded scan and never changes the text.
- (That reviewer wrote to this plan file despite a read-only brief; the edit was discarded, this file is
  the committed version plus this note.)

## Weakest premises
- The sandbox is measured on this Mac with this Claude Code version; a version that changes its sandbox
  settings would silently stop enforcing. The unit test pins the settings written, not the enforcement.
- Known values are refreshed every five minutes, so a key pasted a minute ago is covered by shape only.
- A guide on Codex, Gemini or Grok gets no sandbox (not Claude Code); it keeps the mask and the missing tokens.

## Verification
- engine/secretmask.test.js, engine/knownsecrets.test.js (with controls for files outside Kosmos's places),
  server.guide-secrets-3769.test.js (sandbox on Mac, not on Windows; purpose masked before use; secrets
  loaded), cli.reply-token-3769.test.js (red without the CLI fix).
- Mutations, all RED: no sandbox, no allowLocalBinding, no value masking, no hex form, no zero-width strip,
  no split check, no JWT pattern, collector skipping account folders, purpose unmasked, reply without the
  agent token.
- 858 tests across create, roles, setup-assistant, messages, the guide routes, projects and every CLI suite.
