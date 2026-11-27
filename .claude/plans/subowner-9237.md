# kosmos#9237: a task owned only through its tree reads like a real owner

## Ask
A sub-task with no owner of its own shows its tree's holder beside it (#5678), and in a list that reads exactly like
an owner, so work nobody accepted passes an "is everything owned" scan. Make the two visibly different, and let a
check for unowned work list such tasks.

## Call
Every list says **nobody** first, then who to ask:
- compact and across lists (engine/tasklist.js): `nobody (mara holds #3)` where it said `mara (through #3)`;
- both long lists (install/kosmos, tools/windows/kosmos-cli.js): `(nobody has taken it; ask mara, who holds task 3
  in its tree)` where it said `(owner: mara, through task 3)`.
So the owner column reads "nobody" for every task nobody accepted, and the existing scan for "nobody" lists them; the
row's JSON already separates the two (whoNames is the holders, ownerNames only the tree's holder), unchanged.
engine/markwords.js learns the new marks' words ("nobody has taken", "holds task N", "holds #N") so a title cannot
print a fake one; the old phrases stay, since older installs print them.

## Rejected
- A new `--unowned` filter: a route parameter plus both CLIs plus the compact list, for a list one word already
  gives. Worth doing only if a scan is shown to need it.
- Dropping the inherited owner from the display: #5678 exists because two builders took the same work; "who to ask"
  is still worth showing, only not as an owner.

## Weakest premise
That whoever checks for unowned work reads the owner column (or the row's whoNames) rather than ownerNames alone. A
script reading ownerNames as "owned" is unaffected by this change; the field name was always the inherited one.

## Tests
Pinned wordings updated (cli.task-list-compact-6761, cli.task-who-4887, cli.task-listmarks-render-9203); the mark
words have both arms (cli.task-listmarks-9188: the new marks are caught, ordinary titles with the same words stay
plain), red with the new phrases removed.
