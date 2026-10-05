# #5340: point a project whose folder was moved at its new place ("Move project folder")

## The report
A user's project folder was moved on the same computer; the project kept the old path. 0.7.22 (#4927) already says
the folder is not on this computer instead of handing agents a dead path, but offers no way to fix it.

## Change
- engine/projects.js moveFolder(id, folder): the checks a new project's folder passes (create): a full path, a folder
  that is there, a folder not a file, readable, not a temporary folder, not another project's folder. The folder the
  project already has is refused ("already this project's folder"), not answered "moved". One write (mutate).
- server.js PUT /api/project/<id> {folder}: the person's own act from the page (isViaScreen, as community release and
  #5293's apply: an agent token is refused, browser headers required; a speed bump, not a wall, until #4491), and on
  its own (mixed with other fields is refused, so it is one write that happened or did not). Then every member is
  re-told (syncAgent: the managed block names the folder) and the room gets a note with the new place.
- web/index.html: under the folder warning in the project's settings, a "Move project folder" form, shown only when the
  recorded folder is missing (moved, removed, or on a drive that is not connected). A refusal shows the board's
  sentence ("Not moved: there is no folder at that path."); a success says the agents were told.

## Tests
server.project-movefolder-5340.test.js: a moved folder is re-pointed from the screen (control: it read missing first),
the room is told; an agent token and a request with no browser headers are refused; a file, a missing path, a relative
path, another project's folder and its own folder are refused; a move mixed with a rename is refused and changes
nothing. Mutation: the screen-only check off reds it. Browser check render-movefolder-5340.js: the form shows only for
the missing folder (control: a present folder offers none), a wrong path is refused in plain words, the right one
saves and the warning goes, and the project reads its new folder.

## Not done, said so
- "Every member can read it": the board checks only that IT can read the folder. An agent's own access (a sandbox or a
  macOS privacy grant) cannot be seen from the board.
- No folder picker: the person pastes the path. The native app's Finder picker is not exposed to this page today.
- Copy is Mona Lisa's (15:58): Kosmos moves nothing, it changes where it looks, so no "Move"/"Moved"; no "full path".
  Paste-only is right (no picker), so "paste" stays.

## Review 1 (opus, blind)
- BLOCKER fixed: my rename of the handler's local `msg` (a word-boundary regex) also renamed the ELEMENT id it looked
  up (pjs-move-msg -> pjs-move-said), so the button threw before sending. Fixed; the browser check drives the click.
- BLOCKER fixed: the success sentence sat inside the form that hides on success. It now sits outside the form, and the
  keyboard moves to the next control (Show me where it is).
- W fixed: "the agents were told" was said whatever happened. Each member is now re-told on its screen (a new 'moved'
  membership line, as joining and leaving are), one at a time so a failure skips nobody, and the page says how many
  were reached; with none on the project it says only that Kosmos uses the new place.
- W fixed: a path typed or a sentence said for one project is cleared when another opens.
- W fixed: a test with a member: its instructions name the new folder and not the old one; the answer counts it.
- NITs fixed: a project whose folder is still there is not re-pointed ("still there, so Kosmos keeps using it"; the
  "already this project's folder" check became unreachable and is removed); a file in the folder's place is offered the
  form too; a non-string path is refused.

## Review 2 (sonnet, blind)
- BLOCKER fixed: a `//` comment I put mid-call stopped the browser check parsing (node --check now run on it).
- Noted, then changed: members were told one after another; now in parallel as project create does, each tmux call
  bounded at 5 s, so the answer waits for the slowest pane. Mona Lisa's "Told N of M agents" wording applied.

## Review 3 (opus, blind): no BLOCKER; one WARNING
- W fixed: a member whose instructions could not be updated (syncAgent could_not, or a throw) was still promised the
  new place "when they next start", and the line typed to it claimed "your instructions say so too". Now the route
  counts notUpdated and the page says so; the typed line makes no claim about the file. Test: a member whose folder is
  read-only is counted (control: its file really was not updated); never counting reds it.
- NITs fixed: chat.DELIVERY from the module-level import; a refusal puts the keyboard back in the path box; the README
  row says self-hosted, headless-fine, Chromium only, and what reds it.

## Review 4 (sonnet, blind)
- W fixed: with some members not updated, the line still promised "the others will see it" or "agents now use the new
  location" beside "could not update N". Now, when any member was not updated, the line gives the counts only (Mona Lisa's
  wording for the not-updated clause).
- NIT fixed: a late answer for a project the person has since left neither writes its sentence nor clears the open
  project's path box.
- NIT accepted: a member with NO instructions file counts as not updated (tellAgent's could_not, "we will not create
  one"). Its file names no old folder, so the sentence slightly overstates; telling the cases apart would key on an
  error string.

## Weakest premise
That a person knows where they moved the folder. If not, "Show me where it is" (beside it) cannot help, since the old
place is gone; the form's sentence is the honest limit.
