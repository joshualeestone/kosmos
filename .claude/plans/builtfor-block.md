# builtfor-block: the instruction block's built mark reads tasks.builtFor (follow-up to #9176, after #9177)

#9176 (PR #9183) marks a task built for the agent in its instruction block with its own inline check: builtFreesAll, or
this agent in builtWho. #9177 (Angel, PR #9190) added tasks.builtFor(t, who), the same rule, used by the Assigner and
`task list --mine`. This swaps the inline copy for the helper, so the rule lives in one place.

## Change
- engine/projects.js blockBody `built`: `require('./tasks').builtFor(t, sessionName)` in place of the inline
  builtFreesAll / builtWho test. The `typeof t.builtAt === 'string'` guard stays (builtFor accepts any truthy builtAt).

## Rejected
- tasks.builtForReader (also "built" when the agent holds no open part of its own): the mark's words say "built", and a
  part that is merely finished is not built (#9176 deferred that case for exactly this reason).

## Tests
- engine/builtmark-9176.test.js gains one: across five fixtures (none, own mark, another's mark, the person's mark, an
  unnamed mark) the block marks a task exactly when tasks.builtFor says so. Perturbation (any builtAt marks): 3 fail.
- builtmark-9176, built-sync-9176 and onhold-4771: 30/30.

## Reviews
