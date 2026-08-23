# thread-check: #429, render-thread.js fails on main at the 'stopped' select

## The defect

The check's section-6 reload clicked `.pj-row` bare, the FIRST project row.
The check itself creates two projects (Henderson lease, then 'Reused name'
in 5e). The moment the projects list's ordering put the newer project
first, the reload landed on 'Reused name' (members: mara only), and every
later assertion about Henderson members failed. The visible failure was
selectOption('#pj-thread-who', 'stopped') timing out with "did not find
some options", which names the select rather than the navigation, so the
card read as a fixture or filter regression. Reproduced on a clean sandbox
before the fix; the option list at that point was ['mara'].

## The fix

Locate the row by identity: `.pj-row[data-project="<id>"]`, with the id the
check already holds from creating the project. Order-independent, and a
future ordering change cannot re-break it. One hunk, check-only; no product
code changes.

## Verification

Full check green on a fresh sandboxed fixture server (thread-server.js,
port 4433): all sections through round 30 pass, screenshots written, no
console errors.

## Review bound

One round, one reviewer, declared before starting: the diff is a two-line
selector change plus its comment, in a check.
