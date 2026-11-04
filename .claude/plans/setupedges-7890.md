# setupedges-7890: the sharper edges left from #7883's installer promote (kosmos#7890)

Follow-ups to #7891 (publish-r2.ps1 carries setup.ps1). Items 1 and 2 need other lanes first and are not built here.

## Built
3. **A zip that records no source commit.** Staging reads the working setup.ps1 ONCE and hashes those exact bytes as a
   git blob (`blob <len>` NUL bytes, sha1) to compare with HEAD's blob, instead of `git hash-object` and a second read.
   At -Promote, the staged copy is compared with this tree's HEAD blob (`git cat-file blob HEAD:tools/windows/setup.ps1`):
   - equal: it is published, and the approval line says `setup_source=head`;
   - not equal, or a HEAD git cannot read: REFUSED before any write, as a missing commit is (item 4's reason: prod
     must not move to an app whose installer stays older). The refusal says to promote from the checkout that staged it
     or re-stage. The approval line for a `head` promote records the witness commit (`setup_head=`).
   A zip that records its commit keeps #7891's check and says `setup_source=commit`.
5. **A build staged without an installer** (a rollback to an older build): the line records `setup_left=<sha>` of the
   setup.ps1 it leaves live (or `absent`), with `setup_source=none`.
6. **A zip built from a dirty tree** (`manifest.json source_dirty: true`): a NOTICE at staging. Not refused: the installer
   staged with it is still the committed script.
7. **Harness:** the installer checks compare with `git cat-file blob HEAD:tools/windows/setup.ps1`, not the working file.

## Decided, no code change
4. **-Promote refuses the whole release when this checkout lacks the build's commit.** Kept. Skipping only the installer
   would promote an app whose installer stays older than it; the refusal already names the fix (`git fetch origin`).
   What would change my mind: a promote that has to run from a checkout that cannot fetch.

## Not built here (other lanes)
1. A served check of the SITE address for setup.ps1 after -Promote: needs Baron's redirect first (#7883's site half).
2. On-box V2 running the staged `setup-<v>.ps1` as a file and as `irm | iex`, recorded in the verification record:
   needs the Windows box (Homer's lane).

## Choice made against the card's first option
For item 3's promote side the card offered "compare it to a HEAD blob at promote time, or leave setup.ps1 untouched with
a NOTICE". HEAD's blob is used; leaving setup.ps1 untouched for an installer that FAILS that check was dropped in review (round 1),
since it promotes an app whose installer stays older, the outcome item 4 refuses. (A build staged with NO installer still
leaves setup.ps1 as it is: that is the rollback case of item 5.)
**Weakest premise:** that HEAD at promote time is a fair witness for a zip that names no commit. It is only used when the
zip names none, and a mismatch publishes nothing.

## Tests
tools/test-publish-r2-3725.sh: 127 checks pass (6 new for #7890: head, commit, refused not-HEAD, refused no-git, none with setup_left, dirty). Mutants on the unverified refusal and the dirty notice each fail it. Needs pwsh and python3 (macOS CI runs it).
