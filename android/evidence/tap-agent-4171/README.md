# #4171: a notification tap opens the waiting agent

End to end on the API 35 Moto AVD (2026-09-27), with this branch's app built at c39b88fda (before a
rebase onto main; its app sources are identical to 731718ef2, only main's versionCode differs) and Kano's relay
side from kosmos-relay `push-tap-4140` at 035edbd (coordinator and tunnel built from that commit;
it may still change in Kano's review). Local setup as in #4140/#4151: a dev coordinator and an
HTTPS proxy, the AVD's Chrome mapped to it, a real web push.

1. A push naming the agent session `scorpion` arrives (`1-shade.png`); `usagestats` showed it
   posted by `io.kosmos.app` at 06:14:42 (read at the time, not saved).
2. The tap opens the sign-in page with `?open=kano4140.kosmosplus.com&agent=scorpion`
   (`proxy-taps.txt`), which offers "Open my Kosmos" (`2-after-tap-signin.png`).
3. "Open my Kosmos" hands the agent to `OpenAddressActivity`, which launches the TWA at
   **`https://kano4140.kosmosplus.com/?tab=detail&agent=scorpion#kst=<token>`**, read from the
   AVD Chrome's DevTools list (`opened-urls.txt`, token stripped).

**Control:** the same flow with no agent in the push opens `https://kano4140.kosmosplus.com/#kst=<token>`,
the board home (`opened-urls.txt`; the tap arrived as `agent=` empty, `proxy-taps.txt`).

**Not shown:** the board itself. The Mac address does not resolve in this local setup, so the page
fails with ERR_CONNECTION_CLOSED and Chrome, unable to verify the site, shows a URL bar
(`3-opened.png`), as Kano found on #4140. What this proves is the URL the app opens.
