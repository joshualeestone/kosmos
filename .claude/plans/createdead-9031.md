# createdead-9031: create and Check now do not take "Not logged in" from their own probe as a dead sign-in (kosmos#9031)

## Problem (0.8.23, caught at its promote gate, never in prod)
#9031 added three of `claude -p`'s sentences to CLAUDE_DEAD_AUTH, which the create gate and Check now read. Their probe sets
CLAUDE_CONFIG_DIR to ~/.claude for the DEFAULT account (#3136, #3189). Claude Code then reads another Keychain entry from the one
the plain login is in (#2129), and where it is absent answers "Not logged in". So creating an agent on an ordinary signed-in default
account was refused, and Check now would have marked it rejected. Measured 11-25 on Mortals: the plain entry is there, the entry for
~/.claude is not, and the other accounts' entries are. The sentence (exit 1) is confirmed with an empty folder.

## Call
CLAUDE_DEAD_AUTH is 0.8.22's again, exactly. The agent's own screen and stream (claudesignintext), `kosmos accounts`, the mover and the
usage reader keep #9031: they read the login the agents use, or the agent's own answer.

## Rejected
- Keeping the two "ended" sentences: an old entry for ~/.claude (this Mac has one from October) could print either over a good login.
- Probing the default account with CLAUDE_CONFIG_DIR unset: #3136 took that out because it failed under launchd. A card of its own.

## Left, declared
- Check now and create read an ended login as unknown, as 0.8.22 did.
- An old entry for ~/.claude that prints one of 0.8.22's words refuses a good default login, as in 0.8.22.

## Weakest premise
That the probe's default-folder reading is what Mortals' board got: the board's own output was not kept, so it is from the two entries
and the confirmed sentence.

## Test
server.create-live-1903 (a stand-in claude through the real probe and the real route), server.badge-observed-1921 (Check now),
engine/loginended-9031: each red on main, green here; controls for a refused token.
