# joinwords-4649: one name for joining a project, and the code's instruction names the real path

kosmos#4649, from a friction walk of the "Kosmos as main comms" pilot's join steps on prod 0.7.35 (desktop and iPhone,
sandboxed board).

- The own-computer code said "open Projects, Join a project", but no such button existed. The path was + Add Project,
  then a tab named "Join an external project".
- "External" is wrong when the project is the person's own, from their other computer.

## Done looks like

- The Add Project tab reads "Join a project".
- The join field reads "Enter your code to join a project:".
- The code's instruction names + Add Project and Join a project in order.
- The outside-person invitation's step names the same tab. Josh's verbatim invite sentence is unchanged.
- The tests and browser checks that pin these words follow them.

## Decisions (reversible)

- One name for both kinds of code (own computer and outside person), rather than two tabs or a conditional label.
  The code itself tells the page which kind it is, and after Verify the page already says "Shared by: Your other
  computer" or the owner's address.
- Copy only. The bigger stalls in the walk (the room reading as closed with no local agent; the "needs Kosmos Plus"
  message naming no place to turn it on; the settings placement) are behaviour or placement for the card's owner.
