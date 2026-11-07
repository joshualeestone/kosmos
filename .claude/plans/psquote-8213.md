# psquote-8213: a PowerShell message cut by an apostrophe

Card: kosmos#8213 (daily feedback 11-07). On Windows, a message with an apostrophe inside plain single quotes fails
with a raw PowerShell parse error that does not name the fix.

## Measured first (pwsh 7.x on Agent1s)
- An ODD number of apostrophes: PowerShell refuses the line before any script runs, "The string is missing the
  terminator: '." No code of ours can catch it. So that half is a doctrine fix.
- An EVEN number: the line PARSES, and the text arrives cut into pieces with the apostrophes gone:
  'I can't and won't do it' arrives as "I can", "t", "and", "wont do it". tools/windows/kosmos-cli.js joins the
  arguments with spaces (msg, reply, post), so "I can t and wont do it" would be SENT. Worse than the card says.
- $MyInvocation.Line in kosmos.ps1 holds the line as typed, and $MyInvocation.OffsetInLine where this call starts.
  PowerShell's own parser tokenizes it: 'I can' is StringLiteral then t is an adjacent Identifier; won't do it' and
  Bob's' are Generic tokens holding an apostrophe; --channel='eng' is one Generic token starting with -.

## The call
1. kosmos.ps1 re-reads its own line and refuses (exit 2, one sentence naming the here-string and the doubled
   apostrophe) on (a) a StringLiteral with a word touching its end, or (b) a Generic word holding an apostrophe
   that does not start with -. Only this call's tokens are read (from OffsetInLine to the next ; | && || newline).
   On any error, or with no line (-File), nothing is checked and the call runs as before.
2. The doctrine's PowerShell paragraph quotes the parse error and says to resend as the here-string, and that the
   even case is refused with a sentence. DOCTRINE_VERSION 47, fingerprint pinned, doctrine-past row generated.

Rejected: catching it in kosmos-cli.js. By then the pieces are ordinary arguments, and "I can" "t" cannot be told
from words meant as separate. The raw line is only visible in kosmos.ps1.

## Tests
engine/win32-psquote-8213.test.js runs kosmos.ps1 (copied beside no runtime) under every PowerShell found: pwsh,
and powershell.exe 5.1 on Windows. 3 shapes refuse with exit 2 before the runtime. 6 shapes pass on to the runtime:
a doubled apostrophe, plain words, an option with a quoted value, plain single quotes, double quotes, a here-string.
Mutant (the refusal disabled): exactly the 3 refusal arms fail, 7 pass.

Weakest premise: Windows PowerShell 5.1 tokenizes these lines as pwsh 7 does. Measured only on pwsh here; the
Windows CI runner runs the same arms under 5.1.

## Review round 1
- WARNING: a later word on the line, in the same if or array, refused a correct call. The check now stops at a ) or } this call did not open.
- WARNING: --topic='a's'b' slipped through (every - word was skipped). An --option=value word is now read by its value; a value that is one quoted string passes.
- WARNING: the doctrine said "two" and "refuses it". It now says an even number, "the usual cases", and names the continued-line case the check cannot see (MyInvocation.Line holds the first line only), also in the kosmos.ps1 comment.
- NITs fixed: doubled apostrophes and double-quoted parts in a bare word are set aside (C:\O''Brien, x"it's"); with no PowerShell every arm is registered as a skip, so the count is stable.
- Mutants: drop the ) and } stop -> exactly the two later-word arms fail; skip every - word again -> exactly the option-value arm fails.
