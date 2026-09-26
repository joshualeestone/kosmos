# #3994: View All on the agent's Files, even with one file

## Finished looks like
On an agent's page, the Files block shows View All whenever the agent has at least one file,
including exactly one, and View All opens the Files screen with Open in Finder. Served in a cut.

## Why
Josh 11:18 (on the card): "along with the same View All link so you can see all the files, even
if there is only one file so that you can easily get to the open finder button". Josh 16:14 on
0.6.99: still missing. PR #4007 shipped the white container and not this; paintAgentFiles still
showed View All only when total > listed.

## Change
- paintAgentFiles: `all.hidden = false` once files are listed (the no-files path still hides the
  whole section, per #3757 "let's not show this section").
- Unit (web.agent-files-3614.test.js): one file now shows View All; control: no files, no View All.
- Browser (render-agent-files-3614.js): new agent Una with ONE file: View All shows and opens the
  Files screen with Open in Finder. April (two files, all listed) now expects View All.

## Decided
- With NO files there is still no section and so no View All. Rejected: showing an empty section
  just to carry View All, which reverses Josh's #3757 ruling; he asked for "even if there's only one".
- Weakest premise: that he does not also want Open in Finder reachable for an agent with no files
  yet. If he does, that is a separate call on the #3757 ruling.
