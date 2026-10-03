// crowdsteer client: Turnstile -> session -> WebSocket; one vote per
// direction per round. Direction names come only from the per-session ballot
// (half of sessions see letters), never from this file.
const $ = (id) => document.getElementById(id);
const SCALE = 1.25;
const WARN_AT = 0.75;   // |dose| at which a row shows the breakdown warning
const HAZARD = '<svg class="hazard" viewBox="0 0 24 22" aria-hidden="true">' +
  '<path d="M12 1.5 23 20.5H1Z" fill="#f5cc14" stroke="#121212" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M12 8v6" stroke="#121212" stroke-width="2.4" stroke-linecap="round"/>' +
  '<circle cx="12" cy="17.2" r="1.3" fill="#121212"/></svg>';     // bars and trails span -1.25..+1.25 (drawing clips beyond)
let ballot = [];        // [{key, label}]
let myVotes = {};       // key -> +1 / -1
let doses = {};         // key -> dose
let lastTallies = {};   // key -> {up, down}, from the last closed round
let trail = [];         // [{round, doses}], oldest first
let endsAt = 0;
let audioOn = false;
let me = "";            // this viewer's generated name
let sock = null;
let generating = false;
const player = new Audio();
// the Turnstile script is deferred and calls this when it has loaded
const turnstileReady = new Promise((r) => { window.onTurnstileLoad = r; });
// browser fingerprint (fingerprintjs2), sent with the session request and the
// socket: one browser across many IPs, or many browsers on one IP, is how a
// script shows itself. "" if it is blocked or slow.
const fingerprint = new Promise((resolve) => {
  setTimeout(() => resolve(""), 3000);
  const run = () => {
    try {
      Fingerprint2.get((c) =>
        resolve(Fingerprint2.x64hash128(c.map((x) => x.value).join(""), 31)));
    } catch { resolve(""); }
  };
  window.requestIdleCallback ? requestIdleCallback(run, { timeout: 1000 }) : setTimeout(run, 300);
});

async function start() {
  // countdown and latest answer before the visitor has passed Turnstile;
  // refreshed until the WebSocket takes over
  const poll = () => fetch("/api/state").then((r) => r.json()).then((st) => {
    if (st.ended) return location.replace("/results"); // "/" serves them too now
    if (sock) return;
    endsAt = st.endsAt;
    doses = st.doses || {};
    if (!ballot.length) ballot = st.ballot;
    if (st.latest && st.latest.round !== currentLatest?.round) {
      if (currentLatest) addToFeed(currentLatest);
      showLatest(st.latest);
    }
    setGenerating(st.generating, st.round - 1);
    setTimeout(poll, 5000);
  }).catch(() => setTimeout(poll, 5000));
  poll();
  const { sitekey } = await (await fetch("/api/config")).json();
  const saved = sessionStorage.getItem("cs_session");
  if (saved) return connect(saved);
  await turnstileReady;
  turnstile.render("#turnstile", {
    sitekey,
    callback: async (token) => {
      const r = await fetch("/api/session", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, fp: await fingerprint }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))).error;
        $("gate").querySelector("p").textContent =
          err === "network" ? "Voting and chat aren't available from VPNs, Tor or data centers. You can still watch."
          : err === "rate" ? "Too many attempts from your connection. Wait a minute and reload."
          : "The check failed. Reload the page to try again.";
        return;
      }
      const { session } = await r.json();
      sessionStorage.setItem("cs_session", session);
      connect(session);
    },
  });
}

async function connect(session) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const fp = await fingerprint;
  const ws = new WebSocket(
    `${proto}://${location.host}/ws?s=${encodeURIComponent(session)}&f=${fp}`);
  let opened = false;
  ws.onopen = () => { opened = true; };
  ws.onmessage = (e) => handle(JSON.parse(e.data), ws);
  sock = ws;
  ws.onclose = (e) => {
    if (e.code === 4001) {
      // the server made room for a newer connection from this address
      $("status").textContent = "This page is open somewhere newer on your connection. Reload to vote here.";
      return;
    }
    if (!opened) {
      // rejected before opening: expired or invalid session, so re-verify
      sessionStorage.removeItem("cs_session");
      $("gate").hidden = false;
      $("ballot").hidden = true;
      return start();
    }
    $("status").textContent = "Connection lost. Reconnecting.";
    setTimeout(() => connect(session), 3000);
  };
}

function handle(m, ws) {
  if (m.type === "ended") {
    // the final round closed; give the last entry a moment, then the results
    $("status").textContent = "That was the last round. The results replace this page in a few seconds.";
    setTimeout(() => location.replace("/results"), 20000);
    return;
  }
  if (m.type === "hello") {
    ballot = m.ballot;
    myVotes = m.myVotes || {};
    trail = m.trail || [];
    me = m.you;
    $("gate").hidden = true;
    $("ballot").hidden = false;
    $("chat").hidden = false;
    $("you").textContent = `You are ${me}.`;
    $("chatlog").innerHTML = "";
    (m.chat || []).forEach(addChat);
    buildRows(ws);
    $("feed").innerHTML = "";
    const feed = [...m.feed];
    if (feed.length) showLatest(feed[0]);
    feed.slice(1).reverse().forEach(addToFeed);
  } else if (m.type === "state") {
    $("roundno").textContent = m.round;
    endsAt = m.running ? m.endsAt : 0;
    doses = m.doses;
    setTurnout(m.voters, m.clients);
    setGenerating(m.generating, m.round - 1);
    $("status").textContent = m.paused ? "Paused by the operator."
      : m.generating ? "The model is answering." : "";
    renderRows();
  } else if (m.type === "voted") {
    if (m.v === 0) delete myVotes[m.key]; else myVotes[m.key] = m.v;
    renderRows();
  } else if (m.type === "closed") {
    lastTallies = m.tallies;
    doses = m.doses;
    myVotes = {};
    if (m.trail) trail = [...trail, m.trail].slice(-30);
    renderRows();
  } else if (m.type === "vote-error") {
    $("status").textContent = "Votes too close together were ignored.";
  } else if (m.type === "chat") {
    addChat(m);
  } else if (m.type === "chat-error") {
    $("chaterr").textContent = m.reason;
  } else if (m.type === "output") {
    const prev = currentLatest;
    if (prev && prev.round !== m.round) addToFeed(prev);
    pendingRound = null;
    showLatest(m);
    if (audioOn && m.audio) { player.src = m.audio; player.play().catch(() => {}); }
  }
}

let clients = 0;
function setTurnout(voters, c) {
  if (c !== undefined) clients = c;
  const people = clients === 1 ? "1 person is" : `${clients} people are`;
  $("turnout").textContent =
    `${people} watching, and ${voters} voted last round. This round's votes are shown when it closes.`;
}

const labelOf = (k) => (ballot.find((b) => b.key === k) || { label: k }).label;

function buildRows(ws) {
  const tbody = $("rows");
  tbody.innerHTML = "";
  for (const b of ballot) {
    const tr = document.createElement("tr");
    tr.dataset.key = b.key;
    tr.innerHTML = `
      <th scope="row" class="dir"><span class="name"></span>
        <span class="warn" role="note" hidden>${HAZARD}<span class="warntext"></span></span></th>
      <td class="dose"><span class="num val"></span><span class="track" aria-hidden="true"><span class="fill"></span></span></td>
      <td class="trailcell"><svg class="trail" viewBox="0 0 150 30" preserveAspectRatio="none" role="img"></svg></td>
      <td class="tally"></td>
      <td class="vote">
        <button type="button" data-v="1" aria-pressed="false">Raise</button>
        <button type="button" data-v="-1" aria-pressed="false">Lower</button>
      </td>`;
    tr.querySelector(".dir .name").textContent = b.label;
    tr.querySelectorAll("button").forEach((btn) => {
      btn.setAttribute("aria-label", `${btn.textContent} ${b.label}`);
      btn.addEventListener("click", () => {
        const v = Number(btn.dataset.v);
        ws.send(JSON.stringify({ type: "vote", key: b.key, v: myVotes[b.key] === v ? 0 : v }));
      });
    });
    tbody.appendChild(tr);
  }
  renderRows();
}

function renderRows() {
  for (const tr of $("rows").querySelectorAll("tr[data-key]")) {
    const k = tr.dataset.key;
    const d = doses[k] || 0;
    tr.querySelector(".val").textContent = signed(d);
    // bar grows out of the center line: right for positive, left for negative
    const fill = tr.querySelector(".fill");
    fill.classList.toggle("neg", d < 0);
    fill.style.transform = `scaleX(${Math.min(1, Math.abs(d) / SCALE)})`;
    const warn = tr.querySelector(".warn");
    warn.hidden = Math.abs(d) < WARN_AT;
    if (!warn.hidden) {
      warn.querySelector(".warntext").textContent =
        `At ${signed(d)}. Push further ${d > 0 ? "up" : "down"} and Qwen will have a mental breakdown.`;
    }
    const t = lastTallies[k];
    tr.querySelector(".tally").textContent =
      !t ? "" : t.up + t.down === 0 ? "no votes" : `+${t.up} / −${t.down}`;
    tr.querySelectorAll("button").forEach((btn) =>
      btn.setAttribute("aria-pressed", String(myVotes[k] === Number(btn.dataset.v))));
    drawTrail(tr.querySelector("svg.trail"), k);
  }
}

// the dose trail: this direction's dose over the last 30 rounds, around zero
function drawTrail(svg, key) {
  const W = 150, H = 30, n = 30;
  const y = (d) => (H / 2 - (Math.max(-SCALE, Math.min(d, SCALE)) / SCALE) * (H / 2)).toFixed(1);
  const pts = trail.map((t, i) => {
    const x = (W * (n - trail.length + i)) / (n - 1);
    return `${x.toFixed(1)},${y(t.doses[key] || 0)}`;
  });
  svg.innerHTML =
    `<line class="zero" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>` +
    (pts.length > 1 ? `<polyline points="${pts.join(" ")}"/>` : "");
  const now = trail.length ? signed(trail[trail.length - 1].doses[key] || 0) : "0.00";
  svg.setAttribute("aria-label", `${labelOf(key)} over the last ${trail.length} rounds, now ${now}`);
}

const signed = (d) => (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(2);

function fmtDoses(d) {
  const e = Object.entries(d).filter(([, v]) => v !== 0);
  if (!e.length) return "no steering";
  return e.map(([k, v]) => `${labelOf(k)} ${signed(v)}`).join(", ");
}

// when a round closes the old answer is cleared at once, so it is obvious
// that the next one is being written; it reappears if the GPU times out
let pendingRound = null;
function setGenerating(flag, round) {
  if (flag && !generating) {
    pendingRound = round;
    $("entry-h").textContent = `The model's answer in round ${round}`;
    $("latest").innerHTML = '<p class="pending">Dose given. It is answering.</p>';
    $("latest-doses").textContent = `Doses: ${fmtDoses(doses)}.`;
  } else if (!flag && generating && pendingRound !== null) {
    pendingRound = null;
    $("latest").innerHTML = '<p class="pending">No answer this round. The model may still be waking up.</p>';
  }
  generating = flag;
}

let currentLatest = null;
function showLatest(o) {
  currentLatest = o;
  $("entry-h").textContent = `The model's answer in round ${o.round}`;
  $("latest").innerHTML = "<p></p>";
  $("latest").firstChild.textContent = o.text;
  $("latest-doses").textContent = `Doses: ${fmtDoses(o.doses)}.`;
}

function addToFeed(o) {
  const li = document.createElement("li");
  li.value = o.round;
  li.innerHTML = `<p class="meta"></p><p class="text"></p>`;
  li.children[0].textContent = `Round ${o.round}. Doses: ${fmtDoses(o.doses)}.`;
  li.children[1].textContent = o.text;
  $("feed").prepend(li);
  while ($("feed").children.length > 20) $("feed").lastChild.remove();
}

function addChat(c) {
  const log = $("chatlog");
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  const li = document.createElement("li");
  if (c.name === me) li.className = "mine";
  li.innerHTML = `<span class="who"></span><span class="said"></span>`;
  li.children[0].textContent = c.name;
  li.children[1].textContent = c.text;
  log.appendChild(li);
  while (log.children.length > 50) log.firstChild.remove();
  if (stick) log.scrollTop = log.scrollHeight;
}

$("chatform").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("chatinput").value.trim();
  if (!text || !sock || sock.readyState !== 1) return;
  sock.send(JSON.stringify({ type: "chat", text }));
  $("chatinput").value = "";
  $("chaterr").textContent = "";
});

$("audio").addEventListener("click", () => {
  audioOn = !audioOn;
  $("audio").setAttribute("aria-pressed", String(audioOn));
  if (!audioOn) player.pause();
  else if (currentLatest?.audio) { player.src = currentLatest.audio; player.play().catch(() => {}); }
});

setInterval(() => {
  const band = document.querySelector(".countdown");
  if (!endsAt) {
    $("timer").textContent = "0:--";
    band.classList.remove("closing");
    return;
  }
  const s = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  $("timer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  band.classList.toggle("closing", s <= 10);
  $("countdown-note").textContent = generating
    ? "Dose given. It is answering."
    : "until the next dose";
}, 250);

start();
