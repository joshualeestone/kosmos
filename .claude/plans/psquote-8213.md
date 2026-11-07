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
Mutant (the refusal disabled): exactly the 3 refusal arms fail, 7 pass. (The first version; rounds 1 and 2 below
added arms. The current lists are REFUSED and ALLOWED in the test file.)

Weakest premise: Windows PowerShell 5.1 tokenizes these lines as pwsh 7 does. Measured only on pwsh here; the
Windows CI runner runs the same arms under 5.1.

## Review round 1
- WARNING: a later word on the line, in the same if or array, refused a correct call. The check now stops at a ) or } this call did not open.
- WARNING: --topic='a's'b' slipped through (every - word was skipped). An --option=value word is now read by its value; a value that is one quoted string passes.
- WARNING: the doctrine said "two" and "refuses it". It now says an even number, "the usual cases", and names the continued-line case the check cannot see (MyInvocation.Line holds the first line only), also in the kosmos.ps1 comment.
- NITs fixed: doubled apostrophes and double-quoted parts in a bare word are set aside (C:\O''Brien, x"it's"); with no PowerShell every arm is registered as a skip, so the count is stable.
- Mutants: drop the ) and } stop -> exactly the two later-word arms fail; skip every - word again -> exactly the option-value arm fails.

## Review round 2
- WARNING: the refusal sentence fitted only the cut-into-pieces shape; a quoted part joined to a word (foo'bar') is
  refused too. The sentence now names both, and the test reads its new opening words.
- WARNING (not real, measured): -title:'a b'x was said to go out. It does not: pwsh tokenizes -title: as a Parameter,
  then 'a b' and a touching x, so rule (a) already refuses it. A change to read the value after : made no mutant
  fail, so it was taken back. The arm stays, pinning that the colon form is refused.
- NITs: the PowerShell detection has a 20 s timeout; the always-passing summary test is gone (with no PowerShell
  every arm is a skip); the test header no longer hard-codes counts.
- Kept: about 100 s per shell for this file. The arms spawn a real PowerShell each, which is what proves "nothing was
  sent"; merging them into one driver would lose the per-arm exit code.

## Review round 3
- WARNING (my own premise, wrong): I had set aside '' in a bare word as a doubled apostrophe. Outside quotes '' is an
  EMPTY quoted string, which PowerShell drops: it''s arrives as its, C:\O''Brien as C:\OBrien (measured). A bare word
  holding any single quote now refuses; only an --option= value that is exactly one quoted string passes.
- WARNING: the test had pinned C:\O''Brien as allowed. It is now refused, beside a bare it''s arm.
- WARNING: PowerShell takes curly quotes as quotes. Every quote is matched by class (U+2018 to U+201B single, U+201C
  to U+201E double), written as regex escapes so kosmos.ps1 stays ASCII for Windows PowerShell 5.1. The test's
  drivers carry a byte-order mark so 5.1 reads them as UTF-8.
- NITs fixed: a dash word without = is read whole; rule (a) also refuses a quote touching a double-quoted part or a
  variable; the curly double quote is set aside like the straight one; the doctrine paragraph is rewrapped.
- Mutants: put the '' strip back -> exactly the two bare-'' arms fail; straight quote only -> the curly arm fails;
  no double-quoted touch -> the 'a'"b" arm fails.

## Review round 4
- WARNING: a call after a here-string closes on the same line was refused; $MyInvocation.Line starts inside the
  here-string and the parse errors were ignored. A line the parser reports errors on is now not checked (fail open,
  as the comment always said).
- WARNING: a backtick-escaped quote (can`'t, delivered as can't) was refused. Backtick escapes are set aside.
- WARNING: 'well'-known arrived as [well] [-known] and went out. Rule (a) now refuses anything touching a quoted
  string's end except a closer or separator (| ; ) } , a redirection, a newline).
- NIT not taken: an arm for the backtick-continued line. It is the documented gap, and the doctrine tells agents to
  use the here-string every time.
- Mutants: parse errors ignored -> the here-string-closer arm fails; no backtick strip -> the backtick arm fails;
  the old touch list -> the 'well'-known arm fails.
