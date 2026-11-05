# nocomputer-iphone: #8052 and #8054

Two defects found on a real first-run sign-in with a Kosmos+ test account (11-05), carded at Splinter's ask.
No layout or look changes: those wait for Josh's walkthrough.

## #8052: Kosmos+ refusals shown raw in the iPhone sign-in

Kosmos+ writes its errors lowercase with no closing stop. The App Review door ran them through
`SignIn.sentence`; every other refusal path used `SignIn.cleanMessage` only.

- Add `SignIn.refusal(_:)` = `cleanMessage` then `sentence`.
- Use it at every refusal site: `answer()` (code, second step, setup), `start()` (send code),
  `passkeyFinish`, `passkeyOffer`, enrol. Not `sent_to`, which is not a refusal.
- Logic tests: the five real strings, plus controls (tidy text unchanged, nil and blank stay nil,
  `sent_to` unchanged). Two older tests pinned the raw text; update them to the tidied form.

## #8054: no computer on the account

Measured on a simulator with a real test sign-in:

- Tasks: "Reading your tasks..." for good, because `refreshTasks` needs an admitted computer, so no
  read happens and nothing fails. Fix: `TasksTab` shows the Agents tab's `BoardStates` whenever the
  board phase is not `.live` and not `.starting`.
- Projects: "We cannot read your projects right now" without the reason. Fix: the same `BoardStates`
  when no computer is let in (`macURL == nil`) and the phase is not `.live`/`.starting`; the existing
  sentence stays for a failed read with a computer.
- Settings: stuck on "Reaching your computer". Logged: `read()` set its state synchronously inside the
  update that first drew the tab, and that draw was kept. Fix: `await Task.yield()` at the top of
  `read()`.
- `openBoard` is passed to Tasks and Projects from `ContentView`, as Agents gets it.

## Checks

- All iOS logic suites (`ios/LogicTests/run*.sh`).
- Simulator, both arms: signed out (same branch as no computer) shows the state screens and the
  Settings sentence; the sample live board shows all three tabs unchanged.
- No merge while the 0.7.92 hold is on.
