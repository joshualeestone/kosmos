---
pre_challenge: true
method: challenge-loop
branch: markrender-9203
diff_hash: ba175e4302ae89a77157d2ed46bd5d99ef0ca218672216d56ada3d5eb34e467a
validation: local (cli.task-listmarks-render-9203, cli.task-ownername-9201, cli.task-listmarks-9188, fixture-discipline: 29/29 on the rebased head 49ee63f2e4); the change is one new test file and a comment, so the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-27T09:24:43Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes. Iteration 8 (whole branch, fresh blind reviewer, asked to sort findings into BLOCKER or FOLLOW-UP) found no findings.
**Fixed:** every WARNING below. **Stated as limits in the test header:** a computed `x[k]`, an alias of an alias, `x.f[0].g`, an array one level below an object field, a new VALUE of a known field, a new word inside a group that already holds a mark word.

Every fix below was a mutant on a copy that stayed green before the fix and went red after it, naming its cause.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] fieldsRead saw only top-level fields: a mark on `x.subtasks.zebra` passed --> FIXED: subFieldsRead
- [WARNING] words outside brackets (" - zebra crossing") were thrown away --> FIXED: the leftover must be the printer's fixed columns
- [NIT] the source cut assumed every helper sits before whenWords --> FIXED: helpersOutside
- [NIT] lines without the title are not checked; rows matched by order --> stated in the header

#### Iteration 2
- [WARNING] the alias `const u = x && x.onHoldUntil` (Windows) was not followed --> FIXED
- [WARNING] a helper reading the task under another parameter name was unseen --> FIXED: taskNames
- [WARNING] `?.` and destructuring were unseen --> FIXED
- [NIT] the owner column accepted any lowercase words --> FIXED: the fixtures' names only
- [NIT] one known word passes its whole group --> stated (splitting on commas turns harmless parts red)

#### Iteration 3
- [WARNING] renaming the row variable from x blinded the scan --> FIXED: each printer's row loop must name the task x
- [WARNING] a helper given the task as its SECOND argument was unseen --> FIXED: any argument position, destructured or not

#### Iteration 4
- [WARNING] a call with a nested call among its arguments (`zebraOf(x, Date.now())`) was unseen --> FIXED: balanced-bracket argument scan
- [WARNING] a module-qualified call (`zebra.zebraOf(x)`) was unseen --> FIXED: reported as a helper outside the source
- [STRENGTH] the new scan found a real string-keyed read, `hasOwnProperty.call(x, 'seenByPerson')` --> now counted as a field read

#### Iteration 5
- [WARNING] array element fields read in a callback (`x.builtFiles.filter((e) => e.fingerprint)`, a shape the printers use) were unseen --> FIXED: elementFieldsRead

#### Iteration 6
- [WARNING] an element read through a name declared for the array (`rs.filter((r) => r.met)`, Windows) was unseen --> FIXED

#### Iteration 7
- [WARNING] a callback with two parameters (`(r, i) =>`) was unseen --> FIXED
- [NIT] an array one level below an object field (`w.left.some(...)`) --> stated as unseen
- [STRENGTH] the element scan is pinned: it must still find `builtFiles[].fingerprint`, or the test goes red

#### Iteration 8
- No issues found. Mutants on a new group, a new field, an unbracketed word, a new Mac-program field and a new Windows sub-field each went red; the header and the markwords.js comment were checked against the source.
