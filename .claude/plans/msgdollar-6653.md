# msgdollar-6653: dollar amounts mangled in agent messages (kosmos#6653)

## Goal
An agent feedback report (10-19, paraphrased on the card) says research messages arrived with dollar amounts mangled.
Measured: `"$1,200"` as a double-quoted argument reaches the command as `,200` in bash, zsh and sh, because the shell
reads `$1` first. A quoted heredoc on stdin delivers `it's $1,200` intact in bash and zsh.

## Measured before changing anything
- Both CLIs' help already says it: `kosmos msg [--stdin] ... (--stdin: read the message from stdin, so backticks and $
  arrive as written)` (install/kosmos:2360, tools/windows/kosmos-cli.js:87). The card's ask 1 is half done.
- The agent rules (engine/defaults.js) had the gap. The shell-trap paragraph in "Send readable messages" warned about
  backticks and `$` in code samples, never dollar amounts, and for anything with an apostrophe it said "use the
  heredoc in the next section". That section deliberately shows no `kosmos msg` form (defaults.test.js pins
  `!/kosmos msg --stdin/` there: msg is stored as one line, so it is not offered as a way to format). So an agent
  messaging another agent had no route that keeps both a `$` and an apostrophe.

## Call
Edit the trap paragraph: name dollar amounts with the measured example, and give `kosmos msg --stdin <name>
<<'KOSMOS_MSG'` inline, outside the line-breaks section, so the #2909 pin still holds. Doctrine v34 -> v35 with a log
line, fingerprint pinned, past-doctrine table regenerated (the ceremony the pairing test names).

## Rejected
- Single-quoted examples throughout (`kosmos msg <name> '...'`): an apostrophe in ordinary prose then breaks every
  message, which is worse than the case it fixes.
- A CLI warning on a mangled-looking argument (the card's point 2): a lost number cannot be told from real text.
- A new heading so edited copies are re-offered: precedent for wording fixes is v32 to v34 (in place, no new heading).
- The research listing's source-verification status (card point 3): the research agent's own output, not Kosmos.

## Tests
- New `#6653` test in engine/defaults.test.js: pins the dollar sentence and the msg route, then RUNS the route with a
  stub kosmos in bash and zsh (delivers `it's $1,200`) next to a CONTROL that the double-quoted form arrives as
  `it costs ,200` in the same shell, so the test can show the danger.
- Mutants: dropping the dollar sentence reds "not named"; unquoting the delimiter reds the route pin (the pin fixes the
  exact form the run proves).
- defaults, doctrine (4 files), tools.doctrine-past, web.doctrine-consent, connect-agent: 133/133 before the new test.

## Weakest premise
That the mangled messages were sent as inline double-quoted arguments. The report is paraphrased; a cut in another
layer would look the same. The help lines already covered stdin, so if agents read help, this changes little.

## Not changed
`install/kosmos` and `tools/windows/kosmos-cli.js` help (already right). The `kosmos msg <name> "..."` examples in
"Answering where you were asked" stay double-quoted: they show which verb goes where, and the trap paragraph is the
rule for what goes inside.

## Round 1 (opus): no blocker
- NIT: other amounts expand differently per shell ("$50" is 0 in bash, empty in zsh). The sentence stays true; no change.
- NIT: the double-quoted post/msg examples in "Answering where you were asked" teach the trap before the warning.
  FIXED: they now point at it.

## Round 2 (sonnet): no blocker
- "loses its number" is exact only for $1,200 --> now "and so can a dollar amount".
- "pipe" a heredoc --> "give the text on stdin in a quoted heredoc".
- The pointer ignored PowerShell --> names the here-string.
- The pointer and its heading were unpinned --> the #6653 test pins both (mutant: removing the pointer reds it).

## Round 3 (opus): one warning, introduced by round 2
- WARNING: the PowerShell half of the pointer sent readers to the shell trap, which advises single quotes and has no
  here-string. FIXED: the pointer names "Formatted messages need line breaks" for PowerShell, and the test asserts
  that section shows `kosmos msg <agent> @'`.
- NIT: the new route said `<name>` where both CLIs say `<agent>`. FIXED.
- NIT: `,200` assumes `$1` is unset, which it is in an agent's Bash tool. No change.
