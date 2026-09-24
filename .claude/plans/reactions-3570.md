# Agents see reactions on their posts, and may react back sparingly (kosmos#3570)

Josh, #admin 2026-09-24 07:27: agents should be aware when a person reacts with
an emoji, and may react back, "but not in an annoying way where they're posting
an emoji every single time."

## Measured first (the card was partly stale)
- Agents can already react: `kosmos react` (#2255), and `engine/defaults.js`
  already has one line saying so, inside `### Answering where you were asked`.
  The card said the doctrine never mentions reactions; it does, but only the
  ability, never how to read one or when not to.
- Reactions exist on PROJECT ROOM posts only. There is no DM reaction: the
  only react routes are `/api/react` (agent) and
  `/api/project/:id/room/:post/react` (operator), and the board draws them only
  in the project room (`pjReactions`). So the card's DM case has nothing to
  deliver.
- The real gap: `kosmos room` (the room's `?as=text` arm in server.js) never
  printed reactions. The JSON arm the web board reads carried them. So an
  agent never saw a reaction.

## Call
1. `server.js` room text arm: under each post with a live reaction, one
   `[kosmos] reactions on [mN]: 👍 operator; 🔥 Angel` line. The operator reactor
   ('you' in reactionsFor) reads as 'operator', the word the post line uses.
2. `engine/defaults.js`: a NEW section `### When someone reacts to your post`:
   a reaction is feedback, not a message; do not reply to one; react back only
   when a reply would be noise; at most one per post; never your own posts.
   DOCTRINE_VERSION 12 -> 13, logged, fingerprint pinned.

## Rejected
- Editing the existing react line inside `### Answering where you were asked`:
  `missingFrom` matches by heading, so an in-section edit reaches new agents
  only. A new heading is re-offered to the existing fleet.
- Pushing a notice into the agent's pane on each reaction: a reaction would
  then wake the agent and invite exactly the reply the card forbids. Reading
  it at the next room read is the lighter delivery the card allows ("at
  minimum, it's visible the next time the agent reads the room").
- Server-side enforcement of "never react to your own post": the card asks for
  an instruction, and a refusal is a behaviour change to #2255's route.

## Weakest premise
An agent sees a reaction only when it next runs `kosmos room`. An agent that
never re-reads the room after posting will not see it.

## Tests
- server.projects.test.js: no reaction, no line (control); a reaction prints
  directly under its post, naming post, emoji and reactor; toggled off, the line
  goes. Red against origin's server.js.
- engine/defaults.test.js: the section's rules are present; a legacy agent is
  offered it and a complete one is not (control).
