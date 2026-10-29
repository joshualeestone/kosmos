# agentsfooter-7528: the iPhone Agents list loses its footer line (TestFlight build 16)

## Finished looks like

- The Agents list on the phone shows no "Models and connections are set up on your computer." line under the agents, in light and dark (simulator shots in ~/work/design-shots/kosmos-7528-footer).
- The room logic tests fail if a footer comes back (control run: the old file reds the check, 1 of 623).

## Decided

- Removed the Section's footer entirely rather than rewording it: Josh, 10-28 19:14, "we need to kill" it. The no-agents screen was already footer-free.

## Not verified

- Not run on a device.
