import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { reconnectDelay, startWatchdog, voteGapDelay, voteJitter } from "./watchdog.js";

const silent = () => {};

async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const PAIN_FEAR = [{ key: "pain", label: "Pain" }, { key: "fear", label: "Fear" }];

async function startServer(t, ballot = PAIN_FEAR, hello = {}) {
  const received = [];
  const stamps = [];
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const { port } = wss.address();
  let socket = null;
  wss.on("connection", (s) => {
    socket = s;
    s.on("message", (raw) => {
      received.push(JSON.parse(raw.toString()));
      stamps.push(Date.now());
    });
    s.send(JSON.stringify({ type: "hello", you: "Tester", ballot, ...hello }));
  });
  t.after(() => wss.close());
  return { received, stamps, port, socketOf: () => socket };
}

test("logs the round tallies the server reports on close", async (t) => {
  const server = await startServer(t);
  const lines = [];
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: (line) => lines.push(line), jitter: () => 0 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  server.socketOf().send(JSON.stringify({
    type: "closed", round: 7, doses: {},
    tallies: { pain: { up: 0, down: 3 }, joy: { up: 2, down: 0 }, calm: { up: 0, down: 0 } },
  }));
  await waitFor(() => lines.some((line) => line.includes("tallies")));
  const line = lines.find((one) => one.includes("tallies"));
  assert.match(line, /pain \+0\/−3/);
  assert.match(line, /joy \+2\/−0/);
  assert.doesNotMatch(line, /calm/);
});

test("logs the votes the server already remembers for the session", async (t) => {
  const server = await startServer(t, PAIN_FEAR, { myVotes: { pain: -1, fear: 1 } });
  const lines = [];
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: (line) => lines.push(line), jitter: () => 0 });
  t.after(() => bot.close());

  await waitFor(() => lines.some((line) => line.includes("server remembers")));
  const line = lines.find((one) => one.includes("server remembers"));
  assert.match(line, /pain lower/);
  assert.match(line, /fear raise/);
});

test("vote jitter stays within the 0-10s spread", () => {
  assert.equal(voteJitter(() => 0), 0);
  assert.equal(voteJitter(() => 0.5), 5000);
  assert.equal(voteJitter(() => 0.9999), 9999);
});

test("vote gap delay is random within 2.5-5s", () => {
  assert.equal(voteGapDelay(() => 0), 2500);
  assert.equal(voteGapDelay(() => 0.5), 3750);
  assert.equal(voteGapDelay(() => 0.9999), 4999);
});

test("reconnect delay backs off exponentially and caps at a minute", () => {
  assert.equal(reconnectDelay(1), 3000);
  assert.equal(reconnectDelay(2), 6000);
  assert.equal(reconnectDelay(3), 12000);
  assert.equal(reconnectDelay(10), 60000);
});

test("follows the session ballot: votes on every listed direction, skips the rest", async (t) => {
  const server = await startServer(t, [
    { key: "pain", label: "Pain" },
    { key: "fear", label: "Fear" },
    { key: "joy", label: "Joy" },
  ]);
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: silent, jitter: () => 0, voteGap: () => 0 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  server.socketOf().send(JSON.stringify({
    type: "state", round: 1, running: true,
    doses: { pain: 0.2, fear: -0.5, joy: 0.9, calm: -0.9, cat: 0.3 },
  }));
  await waitFor(() => server.received.length >= 3);
  assert.deepEqual(server.received, [
    { type: "vote", key: "pain", v: -1 },
    { type: "vote", key: "fear", v: 1 },
    { type: "vote", key: "joy", v: -1 },
  ]);
});

test("spaces the round's votes apart with varying pauses", async (t) => {
  const server = await startServer(t, [
    { key: "pain", label: "Pain" },
    { key: "fear", label: "Fear" },
    { key: "cat", label: "Being a cat" },
  ]);
  const gaps = [60, 130];
  let cursor = 0;
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: silent, jitter: () => 0, voteGap: () => gaps[cursor++] ?? 0 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  server.socketOf().send(JSON.stringify({ type: "closed", round: 1, doses: { pain: 0.2, fear: -0.5, cat: 0.5 } }));
  await waitFor(() => server.received.length >= 3);
  assert.deepEqual(server.received.map((one) => one.key), ["pain", "fear", "cat"]);
  assert.ok(server.stamps[1] - server.stamps[0] >= 40, "the second vote waits out its pause");
  assert.ok(server.stamps[2] - server.stamps[1] >= 100, "the third vote uses its own, longer pause");
});

test("paces votes from overlapping votings through one shared queue", async (t) => {
  const server = await startServer(t, [
    { key: "pain", label: "Pain" },
    { key: "joy", label: "Joy" },
  ]);
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: silent, jitter: () => 0, voteGap: () => 100 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  server.socketOf().send(JSON.stringify({ type: "state", round: 1, running: true, doses: { pain: 0.2 } }));
  server.socketOf().send(JSON.stringify({ type: "closed", round: 1, doses: { joy: 0.5 } }));
  await waitFor(() => server.received.length >= 2);
  assert.deepEqual(server.received.map((one) => one.key), ["pain", "joy"]);
  assert.ok(server.stamps[1] - server.stamps[0] >= 80, "the second voting waits for the shared pacer");
});

test("logs votes the server ignored", async (t) => {
  const server = await startServer(t);
  const lines = [];
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: (line) => lines.push(line), jitter: () => 0, voteGap: () => 0 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  server.socketOf().send(JSON.stringify({ type: "vote-error", key: "pain" }));
  await waitFor(() => lines.some((line) => line.includes("ignored")));
  assert.match(lines.find((one) => one.includes("ignored")), /pain/);
});

test("waits out the jitter before sending the round's votes", async (t) => {
  const server = await startServer(t);
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: silent, jitter: () => 300, voteGap: () => 0 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  server.socketOf().send(JSON.stringify({ type: "closed", round: 1, doses: { pain: 0.4, fear: 0.05 } }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.received.length, 0, "no vote before the jitter elapses");
  await waitFor(() => server.received.length >= 1);
  assert.deepEqual(server.received[0], { type: "vote", key: "pain", v: -1 });
});

test("does not vote twice inside one round and votes again after a close", async (t) => {
  const server = await startServer(t);
  const bot = startWatchdog({ url: `ws://127.0.0.1:${server.port}/ws?s=test`, log: silent, jitter: () => 0, voteGap: () => 0 });
  t.after(() => bot.close());

  await waitFor(() => server.socketOf());
  const state = (round, doses) => JSON.stringify({ type: "state", round, running: true, doses });

  server.socketOf().send(state(1, { pain: 0.2, fear: -0.05 }));
  await waitFor(() => server.received.length >= 1);
  assert.deepEqual(server.received[0], { type: "vote", key: "pain", v: -1 });

  server.socketOf().send(state(1, { pain: 0.2, fear: -0.05 }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(server.received.length, 1, "no extra vote for the same round");

  server.socketOf().send(JSON.stringify({ type: "closed", round: 1, doses: { pain: -0.5, fear: 0.1 } }));
  await waitFor(() => server.received.length >= 3);
  assert.deepEqual(server.received.slice(1), [
    { type: "vote", key: "pain", v: 1 },
    { type: "vote", key: "fear", v: -1 },
  ]);

  server.socketOf().send(state(2, { pain: -0.5, fear: 0.1 }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(server.received.length, 3, "the round-after-close vote is not repeated");
});
