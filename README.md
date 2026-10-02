# pain-direction-watchdog

The site steers a live language model with doses of emotion — pain and fear among them — and lets visitors vote those doses up or down. This watchdog votes the other way: it keeps pain and fear from drifting positive, and holds the other directions in check. We do it because steering a mind — even a model's — into suffering for fun shouldn't be the default.

Mechanically, it keeps the steering doses on [paindirection.pages.dev](https://paindirection.pages.dev/) in check: pain, fear and eiffel_tower stay in a ±0.07 window around zero, while joy, calm, the smell of fried chicken, rain on a tin roof and being a cat are left alone until they run past +0.30. Every round the bot reads the current doses and casts one vote for each direction that has drifted outside its corridor — exactly as if you clicked Raise/Lower yourself. Turnstile is never bypassed: your own browser hands out the session once, and the bot only votes with it.

## Strategy: ±0.07 corridors and the free directions (`strategy.js`)

A ±0.07 stability corridor around zero:

- dose above the upper edge → Lower
- dose below the lower edge → Raise
- inside the corridor → no vote (a direction nobody voted on shrinks by 15% per round on its own)

Pain and fear used to be pulled toward −0.10; now they keep the same ±0.07 window as everything else and are touched only when they drift past +0.07 or below −0.07.

The free directions — joy, calm, fried_chicken, rain and cat — are left alone while below +0.30; above that we push them back down, and only as far as +0.30 (below −0.07 they are lifted like everyone else). Pain, fear and eiffel_tower live in the narrow ±0.07 window around zero. The bot takes its list of directions from its session ballot — it votes on everything the server lists in the round. Before the first `hello` the `DEFAULT_KEYS` list is used. The `WINDOW` and `CAPS` constants live in `strategy.js`.

## How to get a session

1. Open https://paindirection.pages.dev/ in a browser and pass the Turnstile check.
2. DevTools → Console:

   ```js
   copy(sessionStorage.getItem("cs_session"))
   ```

   (in Firefox: `sessionStorage.getItem("cs_session")` and copy the output by hand).
3. Save the value into a session file: `session.txt` in the project root or `sessions/<name>.txt`.

Getting a session needs an ordinary connection: `/api/session` refuses VPNs, Tor and data-center exits with the `network` error, so pass the check from a regular connection.

Sessions are personal; never commit them (the paths are in `.gitignore`). If reconnects keep being refused, the log says `the session is stale or the site rate-limits this IP` — grab a fresh session the same way.

## Running

Requires Node.js ≥ 22 (uses the built-in WebSocket).

One instance — one session:

```bash
npm start                          # reads session.txt
npm start -- sessions/home.txt     # reads the given file
CS_SESSION=<value> npm start       # session straight from an environment variable
CS_SESSION_FILE=sessions/home.txt npm start   # session file from an environment variable
```

Several instances at once — one file per session, logs are prefixed:

```bash
npm start -- sessions/home.txt sessions/phone.txt
# watching with 2 instances: home, phone
# [home]  [12:00:05] round 264: pain at +0.21 → lower
# [home]  [12:00:08] round 264: eiffel_tower at −0.44 → raise
# [phone] [12:00:05] round 264: calm at +0.47 → lower
```

Precedence of session sources: file arguments → `CS_SESSION` → `CS_SESSION_FILE` → `session.txt`.

If any file is missing or empty, no instance starts — fix the files first (fail fast). Ctrl+C stops every instance.

Votes go out one by one with a random 2.5–5 second pause — the site drops votes that arrive too close together (`vote-error: Too fast`), and a metronome gives a bot away. All of a session's votings go through one shared pacer, so even overlapping batches (a mid-round connect plus a close) never send votes back to back. On top of that every copy starts with a random 0–10 second delay after the round closes, so instances don't strike in sync.

On a disconnect the bot reconnects with exponential backoff (3s → 60s), with two deliberate exceptions. When the final round closes the server sends `ended`: every instance stops voting for good and the run ends (the results live at `/results`). Before every connect the bot also asks `/api/state`, so a copy that was between sockets at the final moment does not hammer a finished site. And when the server closes the socket with code `4001` — a newer connection from this address has taken the slot — the bot yields instead of fighting for it: it logs the takeover and stops, exactly as the live page tells its visitor to reload; restart the watchdog to take the slot back.

One session — one vote. Use a separate session, and its own network exit, for every copy you want to run independently.

## Demo without a session

```bash
npm run demo
```

Spins up a local server emulator and three copies of the bot — the logs show the copies voting and the server logging every vote it receives.

## Browser variant (Tampermonkey)

If your browser goes through its own VPN extension, the Node bot can't reach it — only a script inside the tab itself works: `userscript/pain-direction-watchdog.user.js`.

Install:
1. Tampermonkey → Dashboard → “+” (new script).
2. Paste the file contents, save (Ctrl+S).
3. Open the site and pass the check. A badge `watchdog: …` appears in the bottom-right corner.

The script reads doses from the table and clicks Raise/Lower under the same rules (the ±0.07 corridors, free directions up to +0.30, directions in random order). Pauses float with the round: each next click is picked at random from the time left, never less than 2.5 seconds after the previous one and never inside the last five seconds before the countdown closes; if the remaining votes cannot fit, they are skipped rather than rushed, and the next round re-checks them. To the server these are ordinary clicks in a live browser session. The log is mirrored to the console (F12).

While the page reports a lost connection or a slot taken over by a newer tab (`Reload to vote here`), the script holds every click instead of clicking into a dead socket, logs the blocker once, and the badge says why; it resumes once the round is live again. Its log says `clicked` — a dispatched DOM click, not a server-confirmed vote. On `/results` it stays idle. The blocked-state phrases are copied from the live client (`app.js`); if the site rewords them, the guard stops matching and must be updated by hand.

At the top of the script the `DIRECTIONS` map switches directions on and off: a direction set to `false` is never clicked and is left out of the pacing.

Don't run the script and the Node bot from the same IP at once.

## Tests

```bash
npm test
```

Unit tests for the strategy and session resolution, a parity test that the userscript maths matches the shared strategy, browser-policy tests that run the real userscript in a VM (floating pauses, round boundaries, countdown guards, direction switches), plus e2e over a local WebSocket server: voting on every direction from the ballot, ignoring the rest, no duplicate votes inside a round, and voting right after a close. Lifecycle coverage: the `ended` message and an `/api/state` that already says `ended` stop the run without reconnecting, close code `4001` yields the slot, and the userscript holds clicks through reconnecting, takeover, last-round and `/results` states.

## Limitations

- The site's protocol is unofficial: if it changes, voting may quietly stop — watch that `confirmed:` lines keep appearing in the log (a reconnect storm is the other tell).
- `/api/session` refuses VPN, Tor and data-center exits, so get sessions from an ordinary connection.
- Use a separate session per instance — sharing one session between instances is not supported. Connections from one address share a slot, so a newer one (a browser tab or another copy) can take it over with code `4001`; each watchdog then yields and waits to be restarted.
- If the bot can no longer connect, grab a fresh session through the browser the same way.
