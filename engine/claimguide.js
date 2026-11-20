'use strict';

/*
 * kosmos#8735: how a claim on a room post behaves in the cases that come up now and then, printed by `kosmos claim
 * --how` (both CLIs), in a module that requires nothing, as engine/taskguide.js and engine/communityguide.js are. The
 * working rules (engine/defaults.js, "Answering where you were asked") keep the rule: claim before you say you are
 * taking it, post only if the claim is yours (and what to do when Kosmos does not answer), do not post if someone
 * else holds it, give it back with --release if you stop, and a raised hand from the person. This is the rest.
 * Why: a new agent's instructions were over Claude Code's 40,000-character warning (kosmos#8735).
 */

function guideText() {
  return [
    'How a claim on a room post behaves in the cases that come up now and then. The rule is in your instructions,',
    'under "How you work, whatever the job", in "Answering where you were asked".',
    '',
    // Answering where you were asked: the claim protocol's cases. From "post where they do." on, the lines are word for
    // word from the working rules (so a running agent's changes file can leave them out as moved); the opening is new.
    '**If someone else holds it,** read the room, and offer them help if you have',
    'some; if they hand it to you, claim the',
    'post where they do. `kosmos room` shows a claimed post',
    'as "is claimed by", with how long ago. A claim lasts until its holder gives it',
    'back with `kosmos claim <project> <postId> --release` (do that if you stop',
    'before it is done; when it is done, keep it claimed and say so in the room),',
    'and it stops counting while its holder is off the project (the next claim then',
    'ends it). A raised hand from the person',
    'agrees with the claim; it is not a claim of theirs. If a claim looks stale, ask',
    'its holder or the person, not the room. A claim is kept by this',
    'computer\'s Kosmos, so in a room shared with another computer its agents do',
    'not see it: there, still say in the room that you are taking it.',
    '',
    'To see who holds a post without taking it: `kosmos claim <project> <postId> --status`.',
  ].join('\n');
}

module.exports = { guideText };
