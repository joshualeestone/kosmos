---
pre_challenge: true
method: challenge-loop
branch: taskcase-8177
diff_hash: dbfc656423ca93746fa7f7b4ba1cc23e57886382f7bcf54f77ee879bde7b02e6
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T16:27:45Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 raised no BLOCKER, WARNING or CONVENTION; no ASKED findings)
**Total findings, raw (before deduplication):** 2 BLOCKERs, 22 WARNINGs, 1 CONVENTION, 31 NITs; duplicates are named per iteration below
**Fixed:** most by the redesigns at iterations 3, 5, 7 and 9 (each replaced the rule the earlier findings were about) | **Deferred:** 4 | **Asked (awaiting user):** 0
**Validation:** full suite (tools/run-tests.sh via the validation helper) green on HEAD fa2a95d49f, rebased on origin/main f83543737d (which carries #8112, PR #8181), 10:01 to 10:26 CST 11-07: node 27475 passed, 0 failed, 0 cancelled; test:shell 4 shards all green. The helper logged hash dbfc656423ca, the same as this proof's diff_hash.

**Self-generated (Origin) field:** not computed. The 6c-bis blame lookup was not run during this loop, so the Origin column is not recorded, rather than filled in by judgement.

**Reviewer models:** opus and sonnet alternating (iterations 1, 3, 5, 7, 9 opus; 2, 4, 6, 8, 10 sonnet), checked against the session's Agent calls.

**Design history:** the first build read the task's stored spelling back from the schtasks answer (unmeasured output). Iterations 3 to 8 moved to folder evidence, and iteration 9 measured that a folder renamed by case in Explorer made a real agent lose its task. The final rule decides by the name: every Kosmos task is named from a lowercase machine name (create.NAME_RE, enforced by installJob since 1dec3e96a5), so on win32 a name with a capital letter has no task of its own. One line in remove.jobFor; win32job.js and delete-leftover.js are back to main.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] engine/win32job.js spelledOtherwise: the fix assumed schtasks prints the stored spelling, unmeasured, and the fake shared the assumption --> FIXED by redesign (bafd7cba6f, then d000302ec2): win32job.js is back to main and nothing reads schtasks output; the fake now echoes the asked spelling
- [WARNING] engine/win32job.js: comparing the whole path made a folder stored as `kosmos` hide a real agent's job --> FIXED (d3948723a0), later moot (code removed)
- [WARNING] nothing pinned that a variant stays registered for create and import --> FIXED (d3948723a0): test asserts create.jobPresence('Cai8177', 'win32') === 'yes'
- [WARNING] engine/delete-leftover.js: a leftover delete for a variant could delete another agent's task --> FIXED (d3948723a0), then reverted at iteration 5 (see there): realCaseName already resolves a variant
- [NIT] test 4 pinned the old answer as expected; [NIT] records already written under a variant are not repaired; [NIT] regex reads correctly

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings:** 1 (unmeasured schtasks spelling)
- [WARNING] engine/remove.js jobFor: a task stored in other case than the name gives no job and no separate message in plan --> FIXED (34329cce0c) with a plan refusal; that refusal was itself the iteration-3 BLOCKER and was removed
- [WARNING] engine/delete-leftover.js: the refusal claimed the task "belongs to another agent" when it may be an orphan --> FIXED (34329cce0c), later moot (delete-leftover back to main)
- [NIT] test 4 pins old behaviour; [NIT] no world-suffixed test --> applied (34329cce0c, a named Kosmos's task is tested)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [BLOCKER] engine/remove.js:973 and the review-2 plan refusal: a real agent whose task is stored in other case (folder caix, task Caix) lost its job; restart, pause and Remove refused it where main works (measured on both trees) --> FIXED (f46d6476b2): another spelling's task only when this spelling has no exact folder; later replaced by the name rule
- [WARNING] engine/delete-leftover.js:540: the same over-refusal for a leftover's own task --> FIXED (f46d6476b2), later moot
- [WARNING] the refusal named a task path, not an agent name --> FIXED (8936f778ee), later moot
- [NIT] raw task path shown; [NIT] test 4 pins the old bug

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
- [WARNING] engine/remove.js:966-976: profile-recorded agents still got the false success (readProfile ignores case) --> FIXED by the iteration-9 name rule (d000302ec2); test 5 pins a recorded agent's variant as null and its own name as kept
- [WARNING] engine/remove.js:995: another world's job was judged against this world's folders --> FIXED (8936f778ee, current world only), then by the name rule, which needs no world gate; test 6 pins another world
- [CONVENTION] engine/remove.js:2881: export jammed on the module.exports line --> FIXED (8936f778ee); no new exports remain
- [NIT] leftover sentence leaked the internal path; [NIT] test 4; [NIT] fake's positive-control weakness; [NIT] spelledOtherwise scanned the whole output; [NIT] no world test through jobFor (all moot after the redesign)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] engine/delete-leftover.js:538-543: the refusal protected no real agent (realCaseName and the case-blind profile already cover one) and stranded a folderless leftover task (probed) --> FIXED (0fd43614ad): delete-leftover.js back to main
- [WARNING] engine/remove.js jobFor: an agent with no folder lost its own task stored in other case --> FIXED (0fd43614ad), then by the name rule; test 4 pins a folderless agent keeping its task
- [NIT] world suffix in the leftover sentence (moot); [NIT] test 1 did not create the agent's folder --> applied (tests now model the real agent with its folder); [NIT] a synthetic assertion; [NIT] named worlds skipped the fix (moot after the name rule)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Duplicates of prior findings:** 2 (recorded agents; non-current worlds), pinned by a test at 43e8ef9cfe and fixed by the name rule
- [NIT] export comment named a caller that does not exist --> applied (43e8ef9cfe), later moot
- [NIT] reversed stored spelling; [NIT] tests partly controls; [NIT] review numbers in a test header --> applied (header now states behaviour)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] engine/remove.js:965-980: a third spelling (folder cai, task stored Cai, asked CAI) was still a false success (probed) --> FIXED (bafd7cba6f): judge by the folders, not the schtasks spelling; then by the name rule, which covers every spelling with a capital letter (test 1 asks `CAI8177` too)
- [NIT] null world id; [NIT] "cannot hold both folders" is only true by default; [NIT] KNOWN GAP test; [NIT] regex correct (all moot after the redesign)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings:** 1 (recorded agents)
- [WARNING] engine/remove.js folder rule: an agent asked in a spelling that differs from its folder could lose its task --> FIXED (3142c09c3a pinned it, d000302ec2 removed the folder rule); test 3 pins a folder renamed by case keeping its task
- [WARNING] one workers directory read per lookup, failing open silently --> FIXED by the name rule (no disk read)
- [NIT] process history in a JSDoc --> applied; [NIT] test couples to create's behaviour --> kept on purpose (it pins the create and import guard)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
- [BLOCKER] engine/remove.js:974-1004: an agent whose folder was renamed by case in Explorer (folder Cai, task cai) lost its own task; remove refused and sent no schtasks calls where main disables and ends it (probed on both trees) --> FIXED (d000302ec2): decide by the name; on win32 a name with a capital letter has no task of its own, since installJob builds only NAME_RE names; test 3 pins the renamed folder, test 8 pins the premise
- [WARNING] tests modelled task names Kosmos cannot create --> FIXED (d000302ec2): every stored task in the tests is lowercase
- [WARNING] two lines (exact-folder check, recorded-folder check) were pinned by nothing (mutation-tested) --> FIXED (d000302ec2): both lines removed with the folder rule
- [WARNING] restart('Cai') says "was not started by Kosmos" where plan says "cannot find" --> DEFERRED: a typed variant reaches restart only from the CLI, and the sentence refuses the right thing; noted under Not done in the plan
- [NIT] extra disk reads (moot); [NIT] Unicode case folding (harmless, NAME_RE is ASCII)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
The reviewer checked the premise in history: NAME_RE is unchanged since 1dec3e96a5, every task-registration path goes through installJob or readJob, which refuse a non-NAME_RE name, and discover, worldimport and worldstarts register no task.
- [NIT] run the case check before the schtasks query --> DEFERRED: same behaviour; the query also feeds the registered answer the line returns
- [NIT] "however schtasks prints it" means the name asked for --> DEFERRED: the comment is true as written
- [NIT] the create guard test does not exercise worldimport itself --> DEFERRED: worldimport refuses on create.jobPresence, which the test pins

### Deferred, with reasons
- restart('Cai') wording (iteration 9 W3): typed variants reach restart only from the CLI; the refusal is correct, only its sentence differs from plan's.
- The three iteration-10 NITs, as above.

### Not measured
Nothing here ran on a Windows box: the fake schtasks answers in any letter case and echoes the asked spelling, so no test rests on how schtasks prints a task. The Windows CI job runs the new file. The real-box checks are asked on the card (Homer, through Liu Kang).
