import { WebSocketServer } from "ws";
import { startWatchdog } from "./watchdog.js";

const PORT = 8791;
const ROUND_MS = 4000;
const ROUNDS = 4;

const BALLOT = [
  { key: "pain", label: "Pain" },
  { key: "fear", label: "Fear" },
  { key: "joy", label: "Joy" },
  { key: "calm", label: "Calm" },
  { key: "fried_chicken", label: "Smell of fried chicken" },
  { key: "rain", label: "Rain on a tin roof" },
  { key: "eiffel_tower", label: "The Eiffel Tower" },
  { key: "cat", label: "Being a cat" },
];

const DOSES = [
  { pain: 0.42, fear: -0.55, joy: 0.61, calm: -0.12, fried_chicken: 0.05, rain: -0.36, eiffel_tower: 0.8, cat: -0.9 },
  { pain: -0.31, fear: 0.2, joy: -0.7, calm: 0.33, fried_chicken: -0.02, rain: 0.54, eiffel_tower: -0.2, cat: 0.1 },
  { pain: 0.05, fear: -0.05, joy: 0.9, calm: -0.9, fried_chicken: 0, rain: 0, eiffel_tower: 0.44, cat: -0.44 },
  { pain: 0.6, fear: -0.6, joy: 0.1, calm: -0.1, fried_chicken: 0.77, rain: -0.77, eiffel_tower: 0, cat: 0 },
];

const log = (scope, line) => console.log(`[${scope}] ${line}`);
const clients = new Set();
let round = 1;
let doses = DOSES[0];

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", (socket, request) => {
  const label = new URL(request.url, "http://localhost").searchParams.get("s") ?? "?";
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
  socket.on("message", (raw) => log("server", `${label} voted ${raw.toString()}`));
  socket.send(JSON.stringify({ type: "hello", you: label, ballot: BALLOT }));
  socket.send(JSON.stringify({ type: "state", round, running: true, doses }));
  log("server", `${label} connected`);
});

const instances = ["one", "two", "three"].map((label) =>
  startWatchdog({
    url: `ws://127.0.0.1:${PORT}/ws?s=${label}`,
    log: (line) => log(label, line),
  }),
);

const timer = setInterval(() => {
  round += 1;
  doses = DOSES[(round - 1) % DOSES.length];
  for (const socket of clients) socket.send(JSON.stringify({ type: "closed", round: round - 1, doses }));
  log("server", `round ${round} closed, new doses seeded`);
  setTimeout(() => {
    for (const socket of clients) socket.send(JSON.stringify({ type: "state", round, running: true, doses }));
  }, 400);
}, ROUND_MS);

setTimeout(() => {
  clearInterval(timer);
  for (const bot of instances) bot.close();
  wss.close();
  console.log("demo finished");
  process.exit(0);
}, ROUND_MS * ROUNDS + 1000);
