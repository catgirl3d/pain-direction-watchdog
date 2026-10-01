import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { decideVote as coreDecideVote, decideVotes as coreDecideVotes } from "./strategy.js";

function loadUserscript(sandbox = { module: { exports: {} } }, directions) {
  let code = readFileSync(new URL("./userscript/pain-direction-watchdog.user.js", import.meta.url), "utf8");
  if (directions !== undefined) {
    // Exercise the config edit a user makes before installing the script.
    let replacements = 0;
    code = code.replace(/const DIRECTIONS = \{[\s\S]*?\};/g, () => {
      replacements++;
      return `const DIRECTIONS = ${JSON.stringify(directions)};`;
    });
    assert.equal(replacements, 1, "the test config must replace exactly one DIRECTIONS declaration");
  }
  vm.runInNewContext(code, sandbox);
  return sandbox.module?.exports;
}

function browserPage({ doses = { pain: 0.8 }, random = () => 0.5, directions } = {}) {
  const page = { now: 0, round: 1, endsAt: 45000, doses: { ...doses }, votes: [], myVotes: new Map(), timerText: null };
  let tick;
  const rows = Object.keys(doses).map((key) => {
    const value = { get textContent() { return String(page.doses[key]); } };
    const buttons = [1, -1].map((vote) => ({
      getAttribute(name) { return name === "aria-pressed" ? String(page.myVotes.get(key) === vote) : null; },
      click() {
        const v = page.myVotes.get(key) === vote ? 0 : vote;
        page.votes.push({ at: page.now, round: page.round, key, v });
        // Model a server confirmation; no votes are sent to the live site.
        if (v === 0) page.myVotes.delete(key); else page.myVotes.set(key, v);
      },
    }));
    return {
      dataset: { key },
      querySelector(selector) {
        if (selector === ".val") return value;
        if (selector === 'button[data-v="1"]') return buttons[0];
        if (selector === 'button[data-v="-1"]') return buttons[1];
        return null;
      },
    };
  });
  const nodes = { roundno: { textContent: "1" }, timer: { textContent: "0:45" }, rows: { querySelectorAll: () => rows } };
  const mounted = new Set();
  const math = Object.create(Math);
  math.random = random;
  loadUserscript({
    window: {},
    document: {
      body: { contains: (node) => mounted.has(node), appendChild: (node) => mounted.add(node) },
      createElement: () => ({ style: {}, textContent: "" }),
      getElementById: (id) => nodes[id] ?? null,
      querySelector: (selector) => rows.find((row) => selector === `#rows tr[data-key="${row.dataset.key}"]`) ?? null,
    },
    Math: math,
    Date: { now: () => page.now },
    CSS: { escape: (key) => key },
    console: { log() {} },
    setInterval: (callback) => { tick = callback; },
  }, directions);
  page.tickAt = (at, { round = page.round, endsAt = page.endsAt } = {}) => {
    if (round !== page.round) page.myVotes.clear();
    page.now = at;
    page.round = round;
    page.endsAt = endsAt;
    nodes.roundno.textContent = String(round);
    const seconds = Math.max(0, Math.ceil((endsAt - at) / 1000));
    nodes.timer.textContent = page.timerText ?? (endsAt
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : "0:--");
    tick();
  };
  page.runUntil = (end) => {
    for (let at = page.now + 500; at <= end; at += 500) page.tickAt(at);
  };
  return page;
}

test("userscript exposes the same decision maths as strategy.js", () => {
  const { decideVote } = loadUserscript();
  const doses = [0.2, 0.0001, 0, 0.07, -0.07, -0.08, -0.2, -1.2, 0.08, 0.5];
  for (const dose of doses) {
    assert.equal(decideVote(dose), coreDecideVote(dose), `dose ${dose}`);
  }
  assert.equal(decideVote(0.2, 0.3), 0, "joy below its +0.30 cap");
  assert.equal(decideVote(0.45, 0.3), -1, "joy above its +0.30 cap");
});

test("userscript builds the same votes as strategy.js", () => {
  const { decideVotes } = loadUserscript();
  const doses = { pain: 0.2, fear: -0.5, joy: 0.2, calm: -0.25, fried_chicken: 0.35, rain: 0.2, cat: 0.05 };
  const keys = ["pain", "fear", "joy", "calm", "fried_chicken", "rain", "cat"];
  const plain = { ...decideVotes(doses, keys) };
  assert.deepEqual(plain, coreDecideVotes(doses, keys));
  assert.deepEqual(plain, { pain: -1, fear: 1, calm: 1, fried_chicken: -1 });
});

test("userscript matches the shared strategy at shifted boundaries and with missing doses", () => {
  const { decideVotes } = loadUserscript();
  const keys = ["pain", "fear", "joy", "eiffel_tower"];
  const inputs = [-0.18, -0.17, -0.1, -0.03, -0.02, 0, 0.3, 0.31]
    .map((dose) => Object.fromEntries(keys.map((key) => [key, dose])));
  inputs.push({}, { pain: null, fear: undefined, joy: 0.35 }, { pain: 0 });
  for (const doses of inputs) assert.deepEqual({ ...decideVotes(doses, keys) }, coreDecideVotes(doses, keys));
});

test("browser leaves pain and fear inside ±0.07 and corrects past both boundaries", () => {
  for (const [dose, vote] of [[-0.18, 1], [-0.08, 1], [-0.07, 0], [0, 0], [0.07, 0], [0.08, -1]]) {
    const page = browserPage({ doses: { pain: dose, fear: dose } });
    page.tickAt(0);
    page.runUntil(45000);
    assert.deepEqual(
      page.votes.map(({ key, v }) => ({ key, v })),
      vote === 0 ? [] : [{ key: "pain", v: vote }, { key: "fear", v: vote }],
      `dose ${dose}`,
    );
  }
});

test("disabled directions never get clicked or overwrite a manually selected vote", () => {
  const page = browserPage({
    doses: { pain: 0.8, fear: -0.18, joy: 0.8 },
    directions: { pain: false, fear: false, joy: false },
  });
  page.myVotes.set("fear", -1);
  page.tickAt(0);
  page.runUntil(45000);
  assert.deepEqual(page.votes, []);
  assert.deepEqual([...page.myVotes], [["fear", -1]]);
});

test("disabled and unlisted directions do not change the enabled direction's voting schedule", () => {
  const pages = [
    { doses: { pain: 0.8 } },
    { doses: { pain: 0.8, fear: 0.8, joy: 0.8, unknown: 0.8 }, directions: { pain: true, fear: false, joy: false } },
  ].map((settings) => {
    let cursor = 0;
    const page = browserPage({ ...settings, random: () => [0.2, 0.75, 0.4, 0.9][cursor++ % 4] });
    page.tickAt(0);
    page.runUntil(45000);
    return page;
  });
  assert.deepEqual(pages[0].votes.map(({ key, v }) => ({ key, v })), [{ key: "pain", v: -1 }]);
  assert.deepEqual(pages[1].votes, pages[0].votes);
});

test("changing rounds shortly after a vote never shortens the 2.5s minimum gap", () => {
  const page = browserPage({ random: () => 0 });
  page.tickAt(0);
  while (page.votes.length === 0 && page.now < 20000) page.tickAt(page.now + 500);
  assert.equal(page.votes.length, 1);
  page.tickAt(page.now + 500, { round: 2, endsAt: page.now + 45500 });
  page.runUntil(page.now + 10000);
  assert.equal(page.votes.length, 2);
  assert.ok(page.votes[1].at - page.votes[0].at >= 2500, JSON.stringify(page.votes));
  assert.deepEqual(page.votes.map(({ round, v }) => ({ round, v })), [{ round: 1, v: -1 }, { round: 2, v: -1 }]);
});

test("all eight needed votes fit before the round reserve even with the longest random delays", () => {
  const keys = ["pain", "fear", "joy", "calm", "fried_chicken", "rain", "eiffel_tower", "cat"];
  const doses = Object.fromEntries(keys.map((key) => [key, 0.8]));
  for (const random of [0, 0.25, 0.5, 0.9, 0.999999]) {
    for (const start of [0, 499]) {
      const page = browserPage({ doses, random: () => random });
      page.tickAt(start);
      page.runUntil(45000);
      assert.deepEqual(page.votes.map(({ key }) => key).sort(), [...keys].sort(), `random=${random}, start=${start}`);
      assert.ok(page.votes.every(({ at, v }) => at <= 40000 && v === -1), JSON.stringify(page.votes));
      for (let i = 1; i < page.votes.length; i++) assert.ok(page.votes[i].at - page.votes[i - 1].at >= 2500);
    }
  }
});

test("fewer pending votes allow longer floating pauses across the remaining round", () => {
  const single = browserPage();
  const multiple = browserPage({ doses: { pain: 0.8, fear: 0.8, joy: 0.8, calm: 0.8 } });
  for (const page of [single, multiple]) {
    page.tickAt(0);
    page.runUntil(45000);
  }
  assert.equal(single.votes.length, 1);
  assert.equal(multiple.votes.length, 4);
  assert.ok(single.votes[0].at >= 15000, JSON.stringify(single.votes));
  assert.ok(multiple.votes[0].at < single.votes[0].at);
  const gaps = multiple.votes.map(({ at }, i) => at - (multiple.votes[i - 1]?.at ?? 0));
  assert.ok(new Set(gaps).size > 1, JSON.stringify(gaps));
  assert.ok(gaps.some((gap) => gap > 5000), JSON.stringify(gaps));
});

test("a late join submits only what fits without voting inside the five-second reserve", () => {
  const page = browserPage({ doses: { pain: 0.8, fear: 0.8, joy: 0.8, calm: 0.8 } });
  page.tickAt(35000);
  page.runUntil(45000);
  assert.ok(page.votes.length > 0 && page.votes.length < 4, JSON.stringify(page.votes));
  assert.ok(page.votes.every(({ at }) => at >= 37500 && at <= 40000), JSON.stringify(page.votes));
});

test("inactive or unreadable countdowns never trigger voting", () => {
  for (const timerText of ["0:--", "", "not a timer"]) {
    const page = browserPage();
    page.timerText = timerText;
    page.tickAt(0);
    page.runUntil(45000);
    assert.deepEqual(page.votes, [], timerText);
  }
});

test("stale countdowns after a delayed tick cannot extend an already known round deadline", () => {
  for (const interrupted of [false, true]) {
    const page = browserPage({ random: () => 0.9 });
    page.tickAt(0);
    if (interrupted) {
      page.timerText = "0:--";
      page.tickAt(1000);
    }
    page.timerText = "0:45";
    page.tickAt(40500);
    page.runUntil(45000);
    assert.deepEqual(page.votes, [], `interrupted=${interrupted}`);
  }
});

test("a delayed vote is rechecked against current doses and already selected buttons", () => {
  for (const [dose, vote] of [[0.8, -1], [-0.18, 1]]) {
    for (const change of ["dose", "selected"]) {
      const page = browserPage({ doses: { pain: dose }, random: () => 0.9 });
      page.tickAt(0);
      if (change === "dose") page.doses.pain = 0;
      else page.myVotes.set("pain", vote);
      page.runUntil(45000);
      assert.deepEqual(page.votes, [], `dose ${dose}, change ${change}`);
    }
  }
});
