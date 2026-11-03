# projinfo-7838: the iPhone project page, slice A (kosmos#7838)

Card: kosmos#7838 (Josh, 11-03 04:15, iPhone build 29: "We need to do the project info screens"). Inventory and call:
issue comment 6600991507; slice status 6601982909.

## Finished looks like

A project room's info button opens a native project page, not the web board in a sheet, in the agent page's shape:
the name, then segments. About shows what the project is for, who is on it and what they do there (and who needs
you), and its open tasks, each a tap away; Files is the project's files. What the phone cannot change yet is one tap
to the board.

## Built

- ios/Kosmos/ProjectInfoView.swift: the page. Header (Paused when it is) and About | Files. About: description,
  members (roleHere else role; Needs you; a tap pushes their chat on top of this page; a member the agents list lacks
  opens the board), open tasks (re-read on every appearance; newest five; each opens TaskPageView; unread says so),
  and a row to the board. Files: FilesView(owner: .project(id), titled: false).
- BoardRoom.swift: ProjectMember.roleHere parsed; ProjectPart, projectMemberLine, projectAbout and the board row's words.
- TasksLogic.swift: projectOpenTasks, projectTasksFooter, projectNoOpenTasks, projectTaskState (sentence case).
- FilesView.swift: `titled` (an embedding page keeps its title; FilesTitle sets none rather than an empty one).
- RoomView.swift: the info button pushes the page; the room's own Files button is gone (Files is a segment).
- Sample board: tasks, task page and Today use the projects sample's id (springcatalogue).
- Tests: ios/LogicTests/room (16 checks, a precedence control fails 3); ios/KosmosUITests/ProjectInfoUITests (opt-in:
  About then Files with controls; a member tap opens their own chat, asserted by its composer).

## Decided

- Two segments now, Settings as the middle one next (rename, description, notifications, pause, archive).
- The name once, in the top bar; the header (segments) stays pinned, since the Files segment is its own list.
- Open tasks include held and scheduled ones, as the board's open count does.

## Left

- Slice B, Settings. UI tests stay opt-in, as the room's others are.
