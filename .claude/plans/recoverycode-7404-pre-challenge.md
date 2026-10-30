---
method: challenge-loop
branch: recoverycode-7404
diff_hash: 0625c836b60e303431b2a3a6305d12b8815e0e1a926a634114edb62c17a451b3
timestamp: 2026-10-30T17:50:19Z
iterations: 4
converged: true
---

# Challenge-loop proof: recoverycode-7404 (a personal backup's recovery code, its keys and the binding tag)

Four blind reviews, one at a time, each by a fresh agent with probes against the real module. Round 4 found no
BLOCKER and one SHOULD-FIX (a test that could not fail), fixed and proved red under that reviewer's own mutant.

#### Iteration 1
- [BLOCKER] an answer lost AFTER Kosmos+ kept the key stranded a code nobody saw; setUp refused forever --> FIXED (pending code kept 0600 until confirmed; retry resumes with the same code; test with the fake keeping the row, then losing the answer)
- [WARNING] setUp could replace a registered key or bury one (file invariant) --> FIXED (file guard, two tests)
- [WARNING] the never-on-disk test checked two text forms only --> FIXED (bytes, both derived keys)
- [NIT] generic export names in the reachability excuses --> FIXED; [NIT] excuse wording --> FIXED; [NIT] epoch rule undocumented --> FIXED (every epoch reuses the code); [NIT] null tag message --> FIXED; [NIT] calls not serialised --> FIXED

#### Iteration 2
- [WARNING] a crash after a successful setUp still stranded the code --> FIXED (resume when registered too)
- [WARNING] a resumed answer did not check the row opens with code and tag --> FIXED
- [WARNING] an ok answer taken as registered unchecked --> FIXED (epoch and member_public, as the company path)
- [WARNING] restore could replace a registered key --> FIXED (key_conflict)
- [WARNING] confirm deleted before registration and needed the network --> FIXED
- [NIT] the same-code retry rule had no failing test --> FIXED (in-flight race test)

#### Iteration 3
- [WARNING] an unreadable pending file read as none, and a retry could overwrite a held code --> FIXED (three states)
- [WARNING] a dead pending code after a restore under another code --> FIXED (any restore deletes it)
- [WARNING] confirm answered about every account --> FIXED (scoped to org, member)
- [WARNING] the success path never checked the STORED row --> FIXED (rowIsOurs on both paths)
- [WARNING] two round-2 fixes had no test that could fail --> FIXED (asserted; five mutants red)
- [NIT] rows lost while the key and code are held --> FIXED (re-send the same registration)

#### Iteration 4
- [WARNING] the dead-code restore test could not fail (its file was deleted first) --> FIXED (red under the reviewer's mutant)
- [NIT] failed read-back blamed Kosmos+ --> FIXED; [NIT] unreadable pending file had no way out --> FIXED (the refusal says what to remove, and when)

#### Validation
engine/personalbackupkey-7404.test.js, engine/backupkeys.test.js, engine/backupmemberkey-5744.test.js: 84/84;
engine.reachable.test.js passes; no temp dirs left behind. The full suites run in CI.
