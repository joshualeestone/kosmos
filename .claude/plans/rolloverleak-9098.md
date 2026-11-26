# rolloverleak-9098: server.dm-rollover-5841.test.js keeps its temp folder inside its own process scope (#9098)

## Symptom (from the card)
A full validation went red on the #4273 leak check alone: one aw-dm-rollover-5841-* folder left (Mortals, 11-25 17:15).

## Cause
The file makes its sandbox with fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-rollover-5841-')) and removes it only in
test.after(). It does not require ./test-support/tmpscope, so a process that ends before after() runs leaves it.

## Change
require('./test-support/tmpscope') first in the file, as #8225 did.

## Proof (measured on this Mac, own TMPDIR per arm)
- A full run: 21/21 pass, 0 folders left.
- Stopped with SIGTERM at 20 s: with the fix 0 folders left; without it (git stash of the file) 1 aw-dm-rollover-5841-*
  folder left. tmpscope sweeps on SIGTERM; a SIGKILL would leave one kts- folder (its documented limit).

## Not done: the class
1,307 test files on main make a raw os.tmpdir() mkdtemp; 843 of them do not require tmpscope (counted with git show
over every *.test.js on origin/main 8049029dc4). Any of them can leave a folder the same way. A guard test plus an
843-file change needs its own card and a full run; noted on #9098, not done here.
