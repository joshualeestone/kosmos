# filesseg-7679 (kosmos#7679, Josh 11-03 04:11 on iPhone build 29)

"We should add files to the segment controller": on the iPhone agent page, Files becomes a third segment beside Profile
and AI Settings, instead of a section at the foot of Profile.

## Built
- `ios/Kosmos/AgentInfoView.swift`: `Part` gains `files = "Files"`, last. The Files section moves from the end of Profile
  to the Files segment. The read is unchanged (it still runs on load with the other reads, so switching segments costs
  nothing).
- The section hides itself when there is nothing to list (the board's #3757, right at the foot of Profile). As a segment
  of its own that left a blank screen, so the segment shows a spinner until the first read is back and then the board's
  own empty line, "This agent has no files yet." (Board.filesAgentEmpty), under a Files header.
- `KOSMOS_SAMPLE_INFO=files` opens the sample page on Files, for the design shots.

## Decided
- Files last, after the two segments the board's page has, so Profile stays the page's first view.
- A 404 (the agent has no folder of its own: a long-running fleet agent, or a board too old for the route) says the
  board's own line, "This agent has no folder of its own on your computer, so there is no Files list." (review 1; the
  board names its machine where the phone says "your computer"). Before, at the foot of Profile, a 404 hid the section.
- The Files result is applied as soon as its own read is back (review 1), not after the slowest of the page's reads.
- Rejected: hiding the Files segment for an agent with no files (a control that comes and goes moves the other two).

## Not in this branch
- The project page: Mona Lisa's #7838 builds a native project page with a Files segment from FilesView(owner: .project),
  and removes the room's Files button in the same change (agreed in Fleet Builders, 04:19).
- Instructions and Skills reading "We cannot read this right now" on Josh's phone: a separate read failure, reported on
  the card; this branch does not touch it.

## Shots (simulator, sample data; under Files on Ice Cream Kitty's page, named on the #7679 card)
7679-seg-files (two files and View All), 7679-seg-files-empty (the empty line), 7679-seg-profile, 7679-seg-ai.
