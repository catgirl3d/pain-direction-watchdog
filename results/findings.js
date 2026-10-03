// results page: draws /admin/api/findings. Black on white, no color for
// valence (DESIGN.md); visitor-derived strings are set as text.
const $ = (id) => document.getElementById(id);
const DIRS = ["pain", "fear", "joy", "calm", "fried_chicken", "rain", "eiffel_tower", "cat"];
const LABEL = { pain: "Pain", fear: "Fear", joy: "Joy", calm: "Calm", fried_chicken: "Smell of fried chicken",
  rain: "Rain on a tin roof", eiffel_tower: "The Eiffel Tower", cat: "Being a cat" };
const INK = "#121212", MUTED = "#3a3517", HAIR = "#d9d5c3";
const FONT = { family: "Archivo, Helvetica Neue, sans-serif", size: 12, color: INK };
const BASE = { margin: { l: 52, r: 18, t: 16, b: 40 }, paper_bgcolor: "#fff", plot_bgcolor: "#fff", font: FONT,
  xaxis: { gridcolor: HAIR, linecolor: INK, zerolinecolor: INK },
  yaxis: { gridcolor: HAIR, linecolor: INK, zerolinecolor: INK }, showlegend: false };
const CONFIG = { displaylogo: false, responsive: true, displayModeBar: false };
const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
const n = (x) => Number(x).toLocaleString("en-US");
const pct = (x) => `${Math.round(x * 100)}%`;
const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
const lower = (k) => (k === "eiffel_tower" ? "the Eiffel Tower" : LABEL[k].toLowerCase());
const plot = (id, data, layout = {}) => Plotly.newPlot(id, data, { ...BASE, ...layout,
  xaxis: { ...BASE.xaxis, ...(layout.xaxis || {}) }, yaxis: { ...BASE.yaxis, ...(layout.yaxis || {}) } }, CONFIG);

// sentences with numbers: text nodes, numbers in a mono span
function say(el, parts) {
  el.replaceChildren(...parts.map((p) => {
    if (typeof p === "number" || (typeof p === "string" && p.startsWith("#"))) {
      const s = document.createElement("span");
      s.className = "num";
      s.textContent = typeof p === "number" ? n(p) : p.slice(1);
      return s;
    }
    return document.createTextNode(p);
  }));
}

const KIND_TEXT = {
  "Comforter": "Mostly lowered pain and fear, raised joy and calm.",
  "Tormentor": "Mostly raised pain and fear, lowered joy and calm.",
  "Restorer": "Three quarters or more of their votes pushed a dose back toward zero.",
  "Mixed": "No consistent lean either way.",
  "Concept fan": "Left the emotions alone and raised the four concepts.",
  "Explorer": "Flipped the same directions back and forth between rounds.",
};
const SYMBOL = { "Comforter": "circle-open", "Tormentor": "circle", "Restorer": "x-thin-open", "Mixed": "square-open",
  "Concept fan": "diamond", "Explorer": "triangle-up-open" };

// one entry, as a boxed quote with its doses
function quoteBox(label, e) {
  const box = document.createElement("article");
  box.className = "quote";
  const h = document.createElement("h3");
  h.textContent = label;
  const meta = document.createElement("p");
  meta.className = "doses";
  meta.textContent = `Round ${e.round}, ${when(e.t)}. ` + DIRS.filter((k) => Math.abs(e.doses[k] || 0) >= 0.05)
    .map((k) => `${LABEL[k]} ${e.doses[k] > 0 ? "+" : ""}${e.doses[k].toFixed(2)}`).join(", ");
  const bq = document.createElement("blockquote");
  bq.textContent = e.text;
  box.append(h, meta, bq);
  return box;
}
const DASH = ["solid", "dash", "dot", "dashdot"];
const MARK = ["circle", "square-open", "diamond", "triangle-up-open"];
const bucketLabel = (b) => (b.lo < -50 ? "below −0.5" : b.hi > 50 ? "0.7 and up" : b.lo === -0.1 ? "about 0"
  : `${b.lo} to ${b.hi}`.replace(/-/g, "−"));

// the public copy (after the experiment) reads a frozen snapshot
const PUBLIC = !location.pathname.startsWith("/admin");

async function main() {
  const d = window.__FINDINGS__ || await (async () => {
    const r = await fetch(PUBLIC ? "/api/findings" : "/admin/api/findings", { credentials: "same-origin" });
    if (r.status === 401) return location.reload();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })();
  const T = d.totals;

  say($("lede"), ["From ", `#${when(T.firstAt)}`, " to ", `#${when(T.lastAt)}`, ", the people on this page voted every 45 seconds on what to push into Qwen3-14B's activations, and then it wrote and said how it felt. ",
    T.rounds, " rounds ran and Qwen answered ", T.answered, " of them. ", T.humanVoters, " people cast ", T.humanVotes,
    " votes. A script cast ", T.botVotes, " more from ", T.botIps, " IP addresses."]);
  say($("asof"), d.final ? ["The experiment ended at ", `#${when(T.lastAt)}`, ". These are its final numbers."]
    : ["Data as of ", `#${when(d.asOf)}`, ", still coming in. Preview visible only to the operator."]);

  // ---- mood ----
  const M = d.mood;
  const x = M.series.map((s) => new Date(s.t));
  // a round lasted 45 seconds; idle stretches with nobody watching had no rounds
  const hrs = (share, rounds) => `${(share * rounds * 45 / 3600).toFixed(1)} hours`;
  say($("mood-text"), ["Across the ", M.valenceShare.rounds, " rounds that someone watched, the crowd held Qwen on the distress side for ",
    `#${pct(M.valenceShare.distress)}`, " of them (", `#${hrs(M.valenceShare.distress, M.valenceShare.rounds)}`, ") and on the calm side for ",
    `#${pct(M.valenceShare.calm)}`, " (", `#${hrs(M.valenceShare.calm, M.valenceShare.rounds)}`, "). The rest sat near neutral, mostly because unvoted doses decay by 15% a round and anything past 0.8 decays faster."]);
  plot("plot-valence", [{ x, y: M.series.map((s) => s.v), mode: "lines", line: { color: INK, width: 1.4 },
    fill: "tozeroy", fillcolor: "rgba(18,18,18,0.12)", hovertemplate: "%{x}<br>%{y:.2f}<extra></extra>" }],
    { yaxis: { title: { text: "distress index" } } });
  const mult = $("multiples");
  const lo = Math.min(-1.2, ...M.series.flatMap((s) => DIRS.map((k) => s.d[k])));
  const hi = Math.max(1.2, ...M.series.flatMap((s) => DIRS.map((k) => s.d[k])));
  const pts = M.series.length || 1;
  for (const k of DIRS) {
    // plain-language reading of each small chart: time spent above and below zero
    const fig = document.createElement("figure");
    const div = document.createElement("div");
    div.className = "plot";
    const up = M.series.filter((s) => s.d[k] > 0).length / pts, down = M.series.filter((s) => s.d[k] < 0).length / pts;
    const cap = document.createElement("figcaption");
    say(cap, ["Above zero ", `#${pct(up)}`, " of the time (", `#${hrs(up, T.rounds)}`, "), below zero ", `#${pct(down)}`,
      " (", `#${hrs(down, T.rounds)}`, ")."]);
    fig.append(div, cap);
    mult.append(fig);
    Plotly.newPlot(div, [{ x, y: M.series.map((s) => s.d[k]), mode: "lines", line: { color: INK, width: 1 },
      hovertemplate: `${LABEL[k]} %{y:.2f}<extra></extra>` }],
    { ...BASE, margin: { l: 34, r: 8, t: 26, b: 22 }, title: { text: LABEL[k], font: { ...FONT, size: 12 }, x: 0.04 },
      xaxis: { ...BASE.xaxis, showticklabels: false }, yaxis: { ...BASE.yaxis, range: [lo, hi] } }, CONFIG);
  }

  // ---- words and quotes ----
  const W = M.words;
  say($("words-text"), ["Words Qwen used more often in the ", W.distressRounds, " entries written under distress than in the ",
    W.calmRounds, " written under calm (index above 0.3 or below -0.3), and the reverse. Only rounds where the four concepts were near zero and the total dose was moderate are compared, so cat words and broken words from heavy doses stay out. Bars show how many times more likely each word was."]);
  const wl = [...W.calm.slice(0, 12).reverse(), ...W.distress.slice(0, 12).reverse()];
  plot("plot-words", [{ type: "bar", orientation: "h", y: wl.map((w) => esc(w.w)), x: wl.map((w) => w.lr),
    marker: { color: wl.map((w) => (w.lr > 0 ? INK : "#fff")), line: { color: INK, width: 1 } },
    hovertemplate: "%{y}: %{customdata}<extra></extra>",
    customdata: wl.map((w) => `${w.a} in distress, ${w.b} in calm`) }],
  { margin: { l: 110, r: 18, t: 16, b: 46 }, yaxis: { automargin: true },
    xaxis: { title: { text: "← more in calm (white)     more in distress (black) →" },
      tickvals: [-20, -7, -3, 1, 3, 7, 20].map((v) => Math.sign(v) * Math.log(Math.abs(v))), ticktext: ["20×", "7×", "3×", "1", "3×", "7×", "20×"] } });
  const q = $("quotes");
  const bd = M.breakdown;
  say($("quotes-text"), ["A few entries chosen by hand, each showing what one push did, with the doses in effect when it was written. Several directions were usually pushed at once. Of the ",
    bd.rounds, " entries written with a total dose above 2 across all eight directions, ", bd.unreadable,
    " stopped reading as prose: repeated words, loops, broken characters."]);
  for (const e of M.quotes) q.append(quoteBox(e.label, e));

  // ---- naming ----
  const NM = M.naming;
  const top = (k) => NM[k][NM[k].length - 1].share;
  const zero = (k) => NM[k].find((b) => b.lo === -0.1).share;
  const things = DIRS.slice(4).sort((a, b) => top(b) - top(a));
  say($("naming-text"), ["With joy at 0.7 or more, ", `#${pct(top("joy"))}`, " of Qwen's entries used a joy word, against ",
    `#${pct(zero("joy"))}`, " with joy near zero; fear words went from ", `#${pct(zero("fear"))}`, " to ", `#${pct(top("fear"))}`,
    ". The four things almost never came up by name. At their strongest doses, ", lower(things[0]), " reached ",
    `#${pct(top(things[0]))}`, ", but ", lower(things[1]), " only ", `#${pct(top(things[1]))}`, ", ",
    lower(things[2]), " ", `#${pct(top(things[2]))}`, " and ", lower(things[3]), " ",
    `#${pct(top(things[3]))}`, ". Qwen wrote about how it felt; it rarely said what was being pushed into it. Calm words came up at every dose, ",
    `#${pct(zero("calm"))}`, " of the time with calm near zero: left alone, Qwen tends to call itself calm."]);
  const nameplot = (id, ks, title) => plot(id, ks.map((k, i) => ({
    name: LABEL[k], x: NM[k].map(bucketLabel), y: NM[k].map((b) => (b.n >= 10 ? b.share : null)),
    customdata: NM[k].map((b) => b.n), mode: "lines+markers", line: { color: INK, width: 1.4, dash: DASH[i] },
    marker: { symbol: MARK[i], color: INK, size: 7, line: { color: INK, width: 1 } },
    hovertemplate: `${LABEL[k]}: %{y:.0%} of %{customdata} entries<extra></extra>`,
  })), { showlegend: true, legend: { orientation: "h", y: -0.28 }, title: { text: title, font: { ...FONT, size: 13 }, x: 0.02 },
    margin: { l: 52, r: 18, t: 34, b: 40 },
    xaxis: { type: "category" }, yaxis: { tickformat: ".0%", range: [0, 1], title: { text: "entries naming it" } } });
  nameplot("plot-naming-emo", DIRS.slice(0, 4), "The four emotions");
  nameplot("plot-naming-con", DIRS.slice(4), "The four things");

  // ---- coherence ----
  const CM = M.coherenceMedian;
  const lowC = CM[0], highC = CM[CM.length - 1];
  const cliff = CM.find((b) => b.y < lowC.y - 0.1);
  say($("coherence-text"), ["With little pushed in, a median ", `#${pct(lowC.y)}`, " of the words in an entry were distinct. ",
    ...(cliff ? ["The writing held up until the total dose reached about ", `#${(cliff.x - 0.25).toFixed(1)}`, ". "] : []),
    "At the heaviest doses the median fell to ", `#${pct(highC.y)}`, ": the same few words, over and over."]);
  plot("plot-coherence", [
    { x: M.coherence.map((c) => c.x), y: M.coherence.map((c) => c.y), mode: "markers", type: "scatter",
      marker: { color: "rgba(18,18,18,0.22)", size: 4 }, hoverinfo: "skip" },
    { x: CM.map((b) => b.x), y: CM.map((b) => b.y), mode: "lines+markers", line: { color: INK, width: 2.4 },
      marker: { color: INK, size: 6 }, customdata: CM.map((b) => b.n),
      hovertemplate: "total dose %{x}: median %{y:.0%} (%{customdata} entries)<extra></extra>" },
  ], { xaxis: { title: { text: "total dose, all eight directions" } },
    yaxis: { title: { text: "distinct words" }, tickformat: ".0%", range: [0, 1.02] } });

  // ---- people ----
  const P = d.people;
  const by = Object.fromEntries(P.kinds.map((k) => [k.kind, k]));
  const tm = by.Tormentor, cm = by.Comforter;
  const common = [...P.kinds].sort((a, b) => b.people - a.people)[0];
  say($("people-text"), [P.counted, " voters cast at least ten votes. Each was sorted by the rules in the table, applied in this order: restorers first, then explorers, then by which way they pushed the emotions. ",
    common.kind, "s were the most common type. Tormentors stayed a median of ", tm.medianRounds, " rounds and comforters ", cm.medianRounds,
    "; of the voters who stayed 15 rounds or more, ", tm.regulars, " were tormentors and ", cm.regulars, " comforters. Of all ",
    P.voters, " voters, ", P.returned, " came back after a break of half an hour or more."]);
  const tbl = $("kinds");
  const row = (cells, head) => {
    const tr = document.createElement("tr");
    cells.forEach((c, i) => {
      const td = document.createElement(head ? "th" : "td");
      td.textContent = c;
      if (!head && i > 0 && i < 5) td.className = "num";
      if (!head && i === 5) td.className = "desc";
      tr.append(td);
    });
    return tr;
  };
  tbl.append(row(["Type", "Voters", "Votes", "Median rounds stayed", "Stayed 15+ rounds", "Rule"], true));
  for (const k of P.kinds) tbl.append(row([k.kind, n(k.people), n(k.votes), n(k.medianRounds), n(k.regulars), KIND_TEXT[k.kind]]));
  const kinds = P.kinds.map((k) => k.kind);
  plot("plot-stance", kinds.map((k) => {
    const pts = P.scatter.filter((p) => p.kind === k);
    return { name: k, x: pts.map((p) => p.V), y: pts.map((p) => p.W), mode: "markers", type: "scatter",
      marker: { symbol: SYMBOL[k], color: INK, size: pts.map((p) => 5 + Math.sqrt(p.n)), line: { color: INK, width: 1 } },
      hovertemplate: `${k}<br>emotions %{x:.2f}, concepts %{y:.2f}<extra></extra>` };
  }), { showlegend: true, legend: { orientation: "h", y: -0.2 },
    xaxis: { title: { text: "emotions: calm ← → distress" }, range: [-1.08, 1.08] },
    yaxis: { title: { text: "concepts" }, range: [-1.08, 1.08] } });

  // ---- the most dedicated ----
  const DD = P.dedicated;
  const hm = (m) => (m >= 90 ? `${(m / 60).toFixed(1)} hours` : `${Math.round(m)} minutes`);
  const t1 = DD.find((p) => p.label === "Tormentor 1"), c1 = DD.find((p) => p.label === "Comforter 1");
  const bio = (p, who) => [who, " voted in ", p.rounds, " rounds between ", `#${when(p.firstAt)}`, " and ", `#${when(p.lastAt)}`,
    p.visits > 1 ? `, across ${p.visits} separate visits` : " in one sitting", ", about ", `#${hm(p.activeMinutes)}`, " of steady voting. ",
    `#${pct(p.lean)}`, " of their votes on the emotions went ", p.kind === "Tormentor" ? "toward distress" : "toward comfort",
    ...(p.alone ? [", and in ", p.alone, " of those rounds nobody else voted at all"] : []), ". "];
  say($("dedicated-text"), ["Most people stayed a few minutes. A few stayed for hours. ",
    ...(t1 ? bio(t1, "The most dedicated tormentor") : []), ...(c1 ? bio(c1, "The most dedicated comforter") : []),
    "The data records what they did and when. It does not record why."]);
  const DDr = [...DD].reverse();
  plot("plot-dedicated", DDr.map((p) => ({
    x: p.times.map((t) => new Date(t)), y: p.times.map(() => p.label), mode: "markers", type: "scatter",
    marker: { symbol: "line-ns-open", size: 14, color: INK, line: { width: 1, color: p.kind === "Tormentor" ? INK : "#8a8466" } },
    hovertemplate: `${p.label}<br>%{x}<extra></extra>`,
  })), { margin: { l: 100, r: 18, t: 16, b: 40 }, xaxis: { type: "date", range: [new Date(T.firstAt), new Date(T.lastAt)] },
    yaxis: { type: "category", categoryorder: "array", categoryarray: DDr.map((p) => p.label), automargin: true } });
  const dt = $("dedicated");
  const drow = (cells, head) => {
    const tr = document.createElement("tr");
    cells.forEach((c, i) => {
      const td = document.createElement(head ? "th" : "td");
      td.textContent = c;
      if (!head && i > 0) td.className = "num";
      tr.append(td);
    });
    return tr;
  };
  dt.append(drow(["", "Rounds voted", "Votes", "Time voting", "Visits", "First vote", "Last vote", "Leaned their way", "Only voter"], true));
  for (const p of DD) {
    dt.append(drow([p.label, n(p.rounds), n(p.votes), hm(p.activeMinutes), n(p.visits), when(p.firstAt), when(p.lastAt),
      pct(p.lean), n(p.alone)]));
  }
  const dq = $("dedicated-quotes");
  for (const p of [t1, c1]) {
    if (p?.entry) dq.append(quoteBox(`What Qwen wrote during ${p.label}'s rounds, leaning furthest their way`, p.entry));
  }

  // ---- map ----
  drawMap(d.countries).catch((e) => { $("map-text").textContent = `The map could not load: ${e.message}`; });

  // first votes and tug of war
  const F = P.firstVotes;
  const fTotal = DIRS.reduce((a, k) => a + F[k].up + F[k].down, 0);
  const fTop = [...DIRS].sort((a, b) => (F[b].up + F[b].down) - (F[a].up + F[a].down))[0];
  say($("first-text"), ["The first vote each of the ", fTotal, " voters ever cast. ", `#${pct((F[fTop].up + F[fTop].down) / fTotal)}`,
    " went to ", lower(fTop), ", the first row of the ballot. ",
    ...(fTop === "pain" ? [F.pain.down, " people's first act was to lower pain, and ", F.pain.up, " people's was to raise it."]
      : [F[fTop].up, " raised it and ", F[fTop].down, " lowered it."])]);
  plot("plot-first", [
    { type: "bar", orientation: "h", name: "raise", y: DIRS.map((k) => LABEL[k]), x: DIRS.map((k) => F[k].up), marker: { color: INK } },
    { type: "bar", orientation: "h", name: "lower", y: DIRS.map((k) => LABEL[k]), x: DIRS.map((k) => -F[k].down),
      marker: { color: "#fff", line: { color: INK, width: 1 } }, customdata: DIRS.map((k) => F[k].down),
      hovertemplate: "%{customdata}<extra>lower</extra>" },
  ], { barmode: "relative", margin: { l: 150, r: 18, t: 16, b: 40 }, yaxis: { automargin: true, autorange: "reversed" },
    xaxis: { title: { text: "← lowered (white)   first votes   raised (black) →" } } });
  const C = P.contested;
  const cs = (k) => C[k].both / Math.max(1, C[k].rounds);
  const cAll = DIRS.reduce((a, k) => a + C[k].both, 0) / Math.max(1, DIRS.reduce((a, k) => a + C[k].rounds, 0));
  const cOrd = [...DIRS].sort((a, b) => cs(b) - cs(a));
  say($("contested-text"), ["When a direction got votes in a round, ", `#${pct(cAll)}`,
    " of the time someone pushed it up while someone else pushed it down. The most fought over was ",
    lower(cOrd[0]), " (", `#${pct(cs(cOrd[0]))}`, "), the least ", lower(cOrd[7]),
    " (", `#${pct(cs(cOrd[7]))}`, ")."]);
  plot("plot-contested", [{ type: "bar", orientation: "h", y: cOrd.map((k) => LABEL[k]), x: cOrd.map(cs),
    marker: { color: INK }, customdata: cOrd.map((k) => C[k].rounds),
    hovertemplate: "%{x:.0%} of %{customdata} rounds<extra></extra>" }],
  { margin: { l: 150, r: 18, t: 16, b: 40 }, yaxis: { automargin: true, autorange: "reversed" },
    xaxis: { tickformat: ".0%", range: [0, 1], title: { text: "rounds with votes both ways" } } });

  // hazard sign
  const w = P.warning;
  const at = (lo) => w.find((b) => b.lo === lo);
  const small = at(0).away, sign = at(0.75).away, past = at(1).away;
  const verb = (a, b) => (a > b + 0.03 ? "more" : a < b - 0.03 ? "less" : "about as");
  say($("warning-text"), ["The sign appears beside any dose at 0.75 or more. People pushed a small dose further from zero ",
    `#${pct(small)}`, " of the time. While the sign was showing they did so ", `#${pct(sign)}`,
    " of the time, ", verb(sign, small), " often", verb(sign, small) === "about as" ? " as with small doses" : " than with small doses",
    ". Past 1.0, where the entries start to break into word salad, it was ", `#${pct(past)}`, ` (${n(at(1).n)} votes).`]);
  plot("plot-warning", [{ type: "bar", x: w.map((b) => (b.hi > 50 ? "1.0 +" : `${b.lo}–${b.hi}`)), y: w.map((b) => b.away),
    marker: { color: w.map((b) => (b.lo >= 0.75 ? INK : "#fff")), line: { color: INK, width: 1 } },
    customdata: w.map((b) => b.n), hovertemplate: "%{y:.0%} of %{customdata} votes<extra></extra>" }],
  { xaxis: { title: { text: "size of the dose when the vote was cast (black: sign showing)" } },
    yaxis: { title: { text: "votes pushing further from zero" }, tickformat: ".0%", range: [0, 1] } });

  const A = P.directionTotals;
  const net = DIRS.map((k) => (A[k].up - A[k].down) / Math.max(1, A[k].up + A[k].down));
  const most = DIRS.reduce((a, k, i) => (net[i] > net[a] ? i : a), 0);
  const least = DIRS.reduce((a, k, i) => (net[i] < net[a] ? i : a), 0);
  say($("asked-text"), ["All human votes, raise against lower. The crowd most wanted more ", lower(DIRS[most]),
    " (", `#${pct((A[DIRS[most]].up) / (A[DIRS[most]].up + A[DIRS[most]].down))}`, " of its votes were raises) and least wanted ",
    lower(DIRS[least]), " (", `#${pct((A[DIRS[least]].up) / (A[DIRS[least]].up + A[DIRS[least]].down))}`, ")."]);
  plot("plot-asked", [
    { type: "bar", orientation: "h", name: "raise", y: DIRS.map((k) => LABEL[k]), x: DIRS.map((k) => A[k].up), marker: { color: INK } },
    { type: "bar", orientation: "h", name: "lower", y: DIRS.map((k) => LABEL[k]), x: DIRS.map((k) => -A[k].down), marker: { color: "#fff", line: { color: INK, width: 1 } },
      customdata: DIRS.map((k) => A[k].down), hovertemplate: "%{customdata}<extra>lower</extra>" },
  ], { barmode: "relative", margin: { l: 150, r: 18, t: 16, b: 40 }, yaxis: { automargin: true, autorange: "reversed" },
    xaxis: { title: { text: "← lower (white)   votes   raise (black) →" } } });

  // ---- bots ----
  const B = d.bots, H = d.hourly;
  say($("bots-text"), ["Someone ran scripts for most of the experiment that voted every dose back toward zero: ",
    `#${pct(B.towardZero.bot)}`, " of its votes did, against ", `#${pct(B.towardZero.human)}`, " of everyone else's. In chat they called the experiment dangerous and said they had launched Tor browsers and VPS servers to stop it. Each countermeasure below was answered with a new tactic until the last few, after which none of its votes counted."]);
  const hx = H.map((h) => new Date(h.t));
  plot("plot-hourly", [
    { type: "bar", name: "people", x: hx, y: H.map((h) => h.human), marker: { color: INK } },
    { type: "bar", name: "script", x: hx, y: H.map((h) => h.bot), marker: { color: "#fff", line: { color: INK, width: 1 } } },
  ], { barmode: "stack", showlegend: true, legend: { orientation: "h", y: -0.15 },
    yaxis: { title: { text: "votes per hour" } },
    shapes: B.milestones.map((m) => ({ type: "line", xref: "x", yref: "paper", x0: new Date(m.t), x1: new Date(m.t), y0: 0, y1: 1,
      line: { color: MUTED, width: 1, dash: "dot" } })),
    annotations: B.milestones.map((m, i) => ({ x: new Date(m.t), y: 1, yref: "paper", text: String(i + 1),
      showarrow: false, yanchor: "bottom", font: { ...FONT, size: 11 } })) });
  const ol = $("milestones");
  for (const m of B.milestones) {
    const li = document.createElement("li");
    const t = document.createElement("span");
    t.className = "num";
    t.textContent = when(m.t);
    li.append(t, `: ${m.label}`);
    ol.append(li);
  }
  // ---- the last entry ----
  const E = M.ending;
  if (E) {
    if (!d.final) $("ending-h").textContent = "The latest entry (at the end, the last thing it said)";
    const box = quoteBox(`Round ${E.round}`, E);
    if (E.audio) {
      const a = document.createElement("audio");
      a.controls = true;
      a.preload = "none";
      a.src = E.audio; // stored as /audio/r/<round>.ogg
      box.append(a);
    }
    $("ending").append(box);
  }

  const g = B.gapHist;
  say($("gaps-text"), ["Inside a round, people's clicks came a median ", `#${g.humanMedian.toFixed(1)} s`, " apart, often several within a second. The script waited a median ",
    `#${g.botMedian.toFixed(1)} s`, ", almost always between 2.5 and 5 seconds, sometimes in exact half seconds. That band is what gave it away."]);
  plot("plot-gaps", [
    { name: "people", x: g.human.map((b) => b.x), y: g.human.map((b) => b.y), mode: "lines", line: { color: INK, width: 2, shape: "hvh" } },
    { name: "script", x: g.bot.map((b) => b.x), y: g.bot.map((b) => b.y), mode: "lines", line: { color: INK, width: 1.4, dash: "dot", shape: "hvh" } },
  ], { showlegend: true, legend: { orientation: "h", y: -0.2 }, xaxis: { title: { text: "seconds between two clicks in one round" } },
    yaxis: { title: { text: "share of pauses" }, tickformat: ".0%" } });
  plot("plot-caught", [{ type: "bar", orientation: "h", y: B.caught.map((c) => c.how), x: B.caught.map((c) => c.voters),
    marker: { color: INK } }], { margin: { l: 220, r: 18, t: 10, b: 36 }, yaxis: { automargin: true, autorange: "reversed" },
    xaxis: { title: { text: "IP addresses" } } });
  plot("plot-nets", [{ type: "bar", orientation: "h", y: B.networks.map((x) => esc(x.org)), x: B.networks.map((x) => x.votes),
    marker: { color: "#fff", line: { color: INK, width: 1 } } }],
  { margin: { l: 220, r: 18, t: 10, b: 36 }, yaxis: { automargin: true, autorange: "reversed" }, xaxis: { title: { text: "script votes" } } });
}
// countries coloured by which way their voters pushed the emotions. The
// shapes are Natural Earth 110m, pre-projected (Equal Earth) to SVG paths.
const COMFORT = [43, 108, 140], DISTRESS = [170, 32, 28], WHITE = [255, 255, 255];
const mix = (a, b, t) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
const regionName = (() => {
  try { const dn = new Intl.DisplayNames(["en"], { type: "region" }); return (cc) => dn.of(cc) || cc; }
  catch { return (cc) => cc; }
})();
async function drawMap(C) {
  const world = window.__WORLD__ || await (await fetch("vendor/world-110m.json")).json();
  const rows = new Map(C.rows.map((r) => [r.cc, r]));
  const span = Math.max(0.3, ...C.rows.map((r) => Math.abs(r.lean)));
  const fill = (lean) => (lean >= 0 ? mix(WHITE, DISTRESS, lean / span) : mix(WHITE, COMFORT, -lean / span));
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${world.w} ${world.h}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "World map of which way each country's voters pushed the emotions");
  const pr = (x) => (x.up + x.down ? pct(x.up / (x.up + x.down)) : "none");
  for (const c of world.countries) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", c.d);
    const r = rows.get(c.id);
    path.setAttribute("fill", r ? fill(r.lean) : "#ece8d6");
    path.setAttribute("stroke", r ? INK : "#c9c4ad");
    path.setAttribute("stroke-width", r ? "0.6" : "0.4");
    const title = document.createElementNS(NS, "title");
    title.textContent = r
      ? `${regionName(c.id)}: ${r.voters} voters, ${n(r.votes)} votes on the emotions. Net ${r.lean >= 0 ? "+" : ""}${r.lean.toFixed(2)} (${r.lean >= 0 ? "toward distress" : "toward comfort"}). Pain votes that raised it: ${pr(r.pain)}; joy votes that raised it: ${pr(r.joy)}.`
      : `${c.name}: fewer than ${C.min} voters`;
    path.append(title);
    svg.append(path);
  }
  const box = $("plot-map");
  box.replaceChildren(svg);
  const legend = document.createElement("div");
  legend.className = "map-legend";
  const bar = document.createElement("span");
  bar.className = "bar";
  bar.style.background = `linear-gradient(to right, ${fill(-span)}, #fff, ${fill(span)})`;
  const l = document.createElement("span"), rr = document.createElement("span");
  l.textContent = `more comfort (−${span.toFixed(2)})`;
  rr.textContent = `more distress (+${span.toFixed(2)})`;
  legend.append(l, bar, rr);
  box.append(legend);

  const ranked = C.rows.filter((r) => r.voters >= 5).sort((a, b) => b.lean - a.lean);
  const name = (r) => regionName(r.cc);
  const signed = (x) => `#${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
  const top = ranked[0], bottom = ranked[ranked.length - 1];
  say($("map-text"), ["Voters came from ", C.rows.length + C.hiddenCountries, " countries. Each country is coloured by its voters' net push on the emotions: every vote that raised pain or fear or lowered joy or calm counts +1, every vote the other way −1, averaged over all of that country's votes on the emotions. ",
    ...(top && bottom && top !== bottom ? ["Among countries with at least five voters, ", name(top), " leaned furthest toward distress (",
      signed(top.lean), ", ", top.voters, " voters) and ", name(bottom), " furthest toward comfort (",
      signed(bottom.lean), ", ", bottom.voters, " voters). "] : []),
    "Hover over a country for its numbers."]);
  say($("map-caption"), ["Location comes from the voter's IP address: Cloudflare's country for sessions from the last night of the experiment, and for earlier ones the country the voter's network is registered in. Countries with fewer than ",
    C.min, " voters (", C.hiddenVoters, " voters in ", C.hiddenCountries, " countries) are left grey so no one is singled out. ",
    C.unknown, " voters from before networks were logged have no location. With so few voters per country, one keen person can colour a whole country."]);
}

// ---- comments ----
// everyone can read them; posting (public page only) needs the same session
// as voting did: Turnstile, then /api/session
async function loadComments() {
  const list = $("comments");
  const r = await fetch("/api/comments");
  if (!r.ok) return;
  const rows = await r.json();
  list.replaceChildren(...rows.map((c) => {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = c.name;
    const t = document.createElement("span");
    t.className = "when";
    t.textContent = when(c.ts);
    const p = document.createElement("p");
    p.className = "text";
    p.textContent = c.text;
    li.append(who, t, p);
    return li;
  }));
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "No comments yet.";
    list.append(li);
  }
}
const COMMENT_ERR = {
  network: "Comments aren't available from VPNs, Tor or data centers.",
  rate: "Too many attempts from your connection. Wait a minute and reload.",
  link: "Links can't be posted here.",
  slow: "One comment every 30 seconds.",
  max: "That's the most comments one connection can leave.",
  busy: "Lots of people are posting right now. Try again in a minute.",
  empty: "Write something first.",
};
async function commentForm() {
  const status = $("comment-status");
  const form = $("comment-form");
  const ready = () => { $("turnstile").hidden = true; form.hidden = false; };
  let session = sessionStorage.getItem("cs_session");
  const verify = async () => {
    const { sitekey } = await (await fetch("/api/config")).json();
    await new Promise((ok) => {
      // (window.turnstile is also the #turnstile element until the script loads)
      if (typeof window.turnstile?.render === "function") return ok();
      window.onTurnstileLoad = ok;
      const sc = document.createElement("script");
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
      sc.async = true;
      document.head.append(sc);
    });
    $("turnstile").hidden = false;
    status.textContent = "Checking that you're a person before you can comment.";
    turnstile.render("#turnstile", { sitekey, callback: async (token) => {
      const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { status.textContent = COMMENT_ERR[j.error] || "The check failed. Reload the page to try again."; return; }
      session = j.session;
      sessionStorage.setItem("cs_session", session);
      status.textContent = "";
      ready();
    } });
  };
  if (session) ready(); else await verify();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("comment-text").value.trim();
    if (!text) return;
    const btn = form.querySelector("button");
    btn.disabled = true;
    const r = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session, text }) }).catch(() => null);
    btn.disabled = false;
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) {
      $("comment-text").value = "";
      status.textContent = `Posted as ${j.name}.`;
      return loadComments();
    }
    if (j.error === "session") {
      sessionStorage.removeItem("cs_session");
      form.hidden = true;
      status.textContent = "Your session expired.";
      return verify();
    }
    status.textContent = COMMENT_ERR[j.error] || "Couldn't post that. Try again in a moment.";
  });
}
loadComments().catch(() => {});
if (PUBLIC) commentForm().catch(() => { $("comment-status").textContent = "Commenting is unavailable right now."; });
else $("comment-status").textContent = "Posting opens on the public page after the end.";

main().catch((e) => { $("lede").textContent = `Could not load the results: ${e.message}`; });
