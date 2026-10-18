# filesdate-6497: the agent Files panel shows name and size

Card: kosmos#6497, filed from Mona Lisa's 0.7.56 noise pass (her next small item, named by Splinter on 2026-10-18).

## Change
agentFileRow(f, compact = false). The agent page's narrow Files panel (paintAgentFiles) passes true: the row shows the
size only and the date is the button's title ("report.pdf, changed 9/20/2026"). The Files screen (paintAgentFilesAll,
View All) keeps the date on the row. This matches the project page's Files panel, which shows the size only.

## Tests
web.agent-files-3614 (panel: no date on the row, the date in the title; CONTROL: the Files screen keeps it) and
render-agent-files-3614 (the panel row is size only, with the hover date). On main both fail.

## Status
- [x] Round 1 (opus): NO NEW FINDINGS. NIT: a preview opened from the panel shows no date in its header, as on the
  project page --> stated in the PR, not changed here.
- [ ] Validation, proof, PR, merge after the 0.7.57 lift.
