'use strict';

/*
 * kosmos#8735 slice 7: how to write a new role when none on the list fits, printed by `kosmos agent --how` (both CLIs),
 * in a module that requires nothing, as engine/claimguide.js is. The Project Manager's instructions (engine/roles.js,
 * PM_MAKE_AGENTS_LINES) keep the rule: confirm in one line before making any agent, the create command, brief it by the
 * name Kosmos prints, a refusal and a make that may have happened. This is the rest: the new-role steps (#4474), word
 * for word, with their own confirmation.
 * Mona Lisa's read (on the card): it opens by saying who it is for, and that the setup guide makes agents only from the
 * list, so the server's refusal (team.vetAgentMember, fromGuide) is named before anyone meets it. Only the PM's lines
 * point here; the setup guide is never taught it (#3769), and roles.test.js asserts that.
 * Why: a new agent's instructions were over Claude Code's 40,000-character warning (kosmos#8735).
 */

function guideText() {
  return [
    'How to make an agent with a role of your own, for an agent that makes agents (a Project Manager). The setup guide',
    'makes agents only from the roles on the list (`kosmos agent roles`), and Kosmos refuses a role the setup guide',
    'wrote. The rule (confirm in one line before you make any agent) is in your instructions, under "How you work".',
    '',
    // NEW_ROLE_LINES before kosmos#8735 slice 7, word for word, so the steps and their confirmation are unchanged.
    'If no role on that list fits, write one, in a file named for it: run',
    '`kosmos agent role-draft --to role-<short-name>.md`, make it say what this',
    'agent is for and how it works (keep its first line, the one that starts',
    '`You are`, and say there what the agent is), then tell the operator the role\'s',
    'name and what it does, and only after they say yes run `kosmos agent create',
    '"<name>" --new-role "<role name>" --from role-<short-name>.md "<why>"`. To make',
    'another agent with that role later, use the same file.',
  ].join('\n');
}

module.exports = { guideText };
