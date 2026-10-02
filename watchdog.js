import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { decideVotes, DEFAULT_KEYS } from "./strategy.js";
import { sessionSpecs } from "./sessions.js";

const DEFAULT_HOST = "wss://paindirection.pages.dev";
const RECONNECT_MS = 3000;
const MAX_RECONNECT_MS = 60000;

// 3s, 6s, 12s, ... capped at a minute: a refused handshake is often a rate
// limit, and hammering it every 3 seconds only keeps the limit hot.
export function reconnectDelay(failures, base = RECONNECT_MS, max = MAX_RECONNECT_MS) {
  return Math.min(base * 2 ** (failures - 1), max);
}

// the live client polls /api/state before its socket takes over; the bot asks
// the same endpoint so an instance that was between sockets when the
// experiment ended stops instead of retrying a finished site forever
export function stateEndpoint(wsUrl) {
  const endpoint = new URL(wsUrl);
  endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
  endpoint.pathname = "/api/state";
  endpoint.search = "";
  return endpoint.href;
}

export const VOTE_JITTER_MS = 10000;

export const VOTE_GAP_MIN_MS = 2500;
export const VOTE_GAP_MAX_MS = 5000;

// the site drops votes that arrive too close together, so every vote goes out
// on its own; humans don't click at a metronome, so each pause is its own
// random gap within [2.5s, 5s)
export function voteGapDelay(random = Math.random, min = VOTE_GAP_MIN_MS, max = VOTE_GAP_MAX_MS) {
  return min + Math.floor(random() * (max - min));
}

// spread the instances out: without this every copy votes in the same second,
// which reads as one machine, not as separate people
export function voteJitter(random = Math.random) {
  return Math.floor(random() * VOTE_JITTER_MS);
}

const signed = (dose) => (dose > 0 ? "+" : dose < 0 ? "−" : "") + Math.abs(dose).toFixed(2);
const stamp = () => new Date().toISOString().slice(11, 19);

export function startWatchdog({
  url,
  keys = null,
  log = console.log,
  jitter = voteJitter,
  voteGap = voteGapDelay,
  WebSocketImpl = WebSocket,
  reconnect = reconnectDelay,
  isEnded = null,
  onEnded = null,
}) {
  let watched = keys ?? DEFAULT_KEYS;
  let ws = null;
  let stopped = false;
  let failures = 0;
  let voteTimers = [];
  let reconnectTimer = null;
  let nextVoteAt = 0;
  let doses = {};
  let lastRound = null;
  // a vote cast right after "closed" already belongs to the round the server
  // is about to announce, so the next "state" must not vote a second time
  let votedAhead = false;
  const resultsPath = (() => {
    try {
      return `${new URL(url).origin}/results`;
    } catch {
      return "/results";
    }
  })();

  // one terminal stop for every path: set the flag before closing the socket,
  // so the close event it triggers cannot schedule a reconnect
  function stop() {
    if (stopped) return;
    stopped = true;
    voteTimers.forEach(clearTimeout);
    voteTimers = [];
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws && ws.readyState !== WebSocketImpl.CLOSED) ws.close();
  }

  function finish(line) {
    if (stopped) return;
    log(`[${stamp()}] ${line}`);
    stop();
    if (!onEnded) return;
    try {
      onEnded();
    } catch (error) {
      log(`[${stamp()}] onEnded callback failed: ${error.message}`);
    }
  }

  function flushVotes(rows, context) {
    if (stopped || !ws || ws.readyState !== WebSocketImpl.OPEN) return;
    for (const { key, vote, dose } of rows) {
      ws.send(JSON.stringify({ type: "vote", key, v: vote }));
      log(`[${stamp()}] ${context}: ${key} at ${signed(dose)} → ${vote < 0 ? "lower" : "raise"}`);
    }
  }

  // One pacer for the whole session. Votes from a mid-round connect and an
  // "after close" round can land back to back, and the site drops anything
  // that comes "too fast", so every vote waits for the shared queue.
  function scheduleVote(row, delay, context) {
    const now = Date.now();
    const at = Math.max(now + delay, nextVoteAt);
    nextVoteAt = at + voteGap();
    const wait = at - now;
    if (wait <= 0) {
      flushVotes([row], context);
      return;
    }
    const timer = setTimeout(() => {
      voteTimers = voteTimers.filter((one) => one !== timer);
      flushVotes([row], context);
    }, wait);
    voteTimers.push(timer);
  }

  function sendVotes(context) {
    const rows = Object.entries(decideVotes(doses, watched)).map(([key, vote]) => ({ key, vote, dose: doses[key] }));
    let delay = jitter();
    for (const row of rows) {
      scheduleVote(row, delay, context);
      delay = 0;
    }
  }

  function handle(message) {
    if (message.type === "hello") {
      if (!keys && Array.isArray(message.ballot) && message.ballot.length) {
        watched = message.ballot.map((entry) => entry.key).filter(Boolean);
      }
      log(`[${stamp()}] connected as "${message.you}", watching ${watched.length} directions: ${watched.join(", ")}`);
      const remembered = Object.entries(message.myVotes ?? {});
      if (remembered.length) {
        const list = remembered.map(([key, vote]) => `${key} ${vote < 0 ? "lower" : "raise"}`).join(", ");
        log(`[${stamp()}] server remembers my votes: ${list}`);
      }
    } else if (message.type === "state") {
      doses = message.doses || doses;
      if (message.running && message.round !== lastRound) {
        if (!votedAhead) sendVotes(`round ${message.round}`);
        lastRound = message.round;
        votedAhead = false;
      }
    } else if (message.type === "closed") {
      doses = message.doses || doses;
      const tallies = Object.entries(message.tallies ?? {})
        .filter(([, tally]) => (tally.up ?? 0) + (tally.down ?? 0) > 0)
        .map(([key, tally]) => `${key} +${tally.up ?? 0}/−${tally.down ?? 0}`);
      if (tallies.length) log(`[${stamp()}] round ${message.round} tallies: ${tallies.join(", ")}`);
      sendVotes("after close");
      votedAhead = true;
    } else if (message.type === "voted") {
      log(`[${stamp()}] confirmed: ${message.key} ${message.v === 0 ? "cleared" : message.v < 0 ? "lower" : "raise"}`);
    } else if (message.type === "vote-error") {
      log(`[${stamp()}] vote ignored by the server: ${JSON.stringify(message)}`);
    } else if (message.type === "ended") {
      finish(`the experiment has ended; results: ${resultsPath}`);
    }
  }

  // the only entry points are the initial call and the one close-driven
  // timer, so this instance never has two connects in flight at once
  async function connect() {
    if (stopped) return;
    if (isEnded) {
      let ended = false;
      try {
        ended = await isEnded();
      } catch (error) {
        log(`[${stamp()}] could not check /api/state: ${error.message}`);
      }
      if (stopped) return;
      if (ended) {
        finish(`the experiment has ended (per /api/state); results: ${resultsPath}`);
        return;
      }
    }
    const socket = new WebSocketImpl(url);
    ws = socket;
    socket.onopen = () => {
      if (stopped || ws !== socket) return;
      log(`[${stamp()}] socket open`);
      failures = 0;
      lastRound = null;
      votedAhead = false;
    };
    socket.onmessage = (event) => {
      if (stopped || ws !== socket) return;
      try {
        handle(JSON.parse(event.data));
      } catch (error) {
        log(`[${stamp()}] ignored a bad message: ${error.message}`);
      }
    };
    socket.onclose = (event) => {
      if (stopped || ws !== socket) return;
      if (event.code === 4001) {
        // the site made room for a newer connection from this address; a live
        // page shows "Reload", and the bot yields the same way instead of
        // evicting whoever is there now
        log(`[${stamp()}] a newer connection from this address took the slot (4001); yielding — restart the watchdog to take it back`);
        stop();
        return;
      }
      failures += 1;
      const delay = reconnect(failures);
      const hint = failures >= 3 ? " (still refusing: the session is stale or the site rate-limits this IP)" : "";
      // the reason comes from the server: strip control characters so it
      // cannot forge log lines or drive the terminal
      const reason = event.reason ? event.reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ") : "";
      const details = event.code ? ` (code ${event.code}${reason ? `: ${reason}` : ""})` : "";
      log(`[${stamp()}] disconnected${details}, reconnecting in ${delay / 1000}s${hint}`);
      reconnectTimer = setTimeout(connect, delay);
    };
    socket.onerror = () => {};
  }

  connect();
  return { close: stop };
}

function main() {
  const specs = sessionSpecs(process.argv.slice(2));
  const loaded = [];
  const problems = [];
  for (const spec of specs) {
    let session = spec.session;
    if (!session) {
      try {
        session = readFileSync(spec.file, "utf8").trim();
      } catch {
        problems.push(`${spec.label}: cannot read ${spec.file}`);
        continue;
      }
    }
    if (!session) problems.push(`${spec.label}: empty session`);
    else loaded.push({ label: spec.label, session });
  }
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }

  let bots = [];
  let ended = false;
  let probe = null;
  const stateUrl = stateEndpoint(DEFAULT_HOST);
  // one shared in-flight request: five sessions starting together still ask
  // /api/state once. Fail-open — an unreachable state endpoint must not stop
  // voting, and a confirmed end sticks so the next probe skips the network.
  const isEnded = () => {
    if (ended) return Promise.resolve(true);
    if (!probe) {
      probe = fetch(stateUrl, { signal: AbortSignal.timeout(5000) })
        .then((response) => (response.ok ? response.json() : false))
        .then((state) => Boolean(state && state.ended))
        .catch(() => false)
        .finally(() => { probe = null; });
    }
    return probe;
  };
  // the experiment is site-wide: the first instance to learn it has ended
  // stops every instance, including the ones that are mid-reconnect
  const onEnded = () => {
    if (ended) return;
    ended = true;
    console.log(`the experiment has ended; stopping ${bots.length} instance${bots.length === 1 ? "" : "s"}`);
    bots.forEach((bot) => bot.close());
  };
  bots = loaded.map(({ label, session }) =>
    startWatchdog({
      url: `${DEFAULT_HOST}/ws?s=${encodeURIComponent(session)}`,
      log: (line) => console.log(`[${label}] ${line}`),
      isEnded,
      onEnded,
    }),
  );
  console.log(`watching with ${bots.length} instance${bots.length > 1 ? "s" : ""}: ${loaded.map((one) => one.label).join(", ")}`);
  process.on("SIGINT", () => {
    bots.forEach((bot) => bot.close());
    process.exit(0);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
