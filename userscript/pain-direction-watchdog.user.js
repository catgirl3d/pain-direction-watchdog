// ==UserScript==
// @name         Pain Direction Watchdog
// @namespace    pain-direction-watchdog
// @version      0.4.0
// @description  Keeps steering doses in their corridors by clicking Raise/Lower at a human pace.
// @match        https://paindirection.pages.dev/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // Configuration: vote only on directions set to true.
  const DIRECTIONS = {
    pain: true,
    fear: true,
    joy: true,
    calm: true,
    fried_chicken: true,
    rain: true,
    eiffel_tower: true,
    cat: true,
  };

  // keep in sync with strategy.js in this repository
  const WINDOW = 0.07;
  const CAPS = { joy: 0.3, calm: 0.3, fried_chicken: 0.3, rain: 0.3, cat: 0.3 };

  function decideVote(dose, cap = WINDOW) {
    if (dose > cap) return -1;
    if (dose < -WINDOW) return 1;
    return 0;
  }

  function decideVotes(doses, keys) {
    const votes = {};
    for (const key of keys) {
      const dose = doses?.[key];
      if (dose == null) continue;
      const vote = decideVote(Number(dose), CAPS[key] ?? WINDOW);
      if (vote !== 0) votes[key] = vote;
    }
    return votes;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { decideVote, decideVotes };
    return;
  }
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const TICK_MS = 500;
  const GAP_MIN_MS = 2500;
  const ROUND_END_BUFFER_MS = 5000;
  // the live page tells us when the socket is gone or the experiment is over.
  // Clicking then only dispatches into a dead socket and fakes the log, so
  // hold every vote until the page reports a live round again. These phrases
  // mirror the live client's status texts (app.js): if the site rewords them,
  // the guard silently stops matching and must be updated by hand.
  const BLOCKED_STATUS = /Reload to vote here|Connection lost\. Reconnecting\.|That was the last round\./;

  function randomGap(remainingMs, votesLeft) {
    const budget = remainingMs - ROUND_END_BUFFER_MS;
    // Reserve a minimum gap and one tick of scheduling slack per vote.
    const slots = Math.min(votesLeft, Math.floor(budget / (GAP_MIN_MS + TICK_MS)));
    if (slots <= 0) return null;
    const freeMs = budget - slots * (GAP_MIN_MS + TICK_MS);
    // Sample the first of the remaining random slots over the free time.
    return GAP_MIN_MS + freeMs * (1 - (1 - Math.random()) ** (1 / slots));
  }

  const shuffle = (items) => items.sort(() => Math.random() - 0.5);

  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:99999;background:#101418;color:#7dd3a0;" +
    "font:12px/1.4 ui-monospace,monospace;padding:6px 9px;border-radius:8px;opacity:.85;max-width:340px;pointer-events:none;";
  const setStatus = (text) => { badge.textContent = `watchdog: ${text}`; };
  const log = (text) => console.log(`[watchdog] ${text}`);

  function mountBadge() {
    if (!document.body.contains(badge)) document.body.appendChild(badge);
  }

  function readRound() {
    const raw = document.getElementById("roundno")?.textContent ?? "";
    const round = Number.parseInt(raw, 10);
    return Number.isFinite(round) ? round : null;
  }

  function readDoses() {
    const rows = document.getElementById("rows");
    if (!rows) return null;
    const entries = rows.querySelectorAll("tr[data-key]");
    if (!entries.length) return null;
    const doses = {};
    for (const row of entries) {
      const text = row.querySelector(".val")?.textContent ?? "";
      const value = Number(text.replace("\u2212", "-").trim());
      if (Number.isFinite(value)) doses[row.dataset.key] = value;
    }
    return doses;
  }

  let lastRound = null;
  let nextAt = 0;
  let roundDeadline = 0;
  let blockedReason = null;

  function tick() {
    if (typeof location !== "undefined" && location.pathname.startsWith("/results")) return;
    mountBadge();
    const status = document.getElementById("status")?.textContent ?? "";
    if (BLOCKED_STATUS.test(status)) {
      nextAt = 0;
      const reason = status.includes("Reload to vote here")
        ? "connection taken over elsewhere — reload the page to resume"
        : status.includes("last round")
          ? "experiment finished — the results replace the page soon"
          : "site is reconnecting — holding votes";
      setStatus(reason);
      if (reason !== blockedReason) {
        blockedReason = reason;
        log(`holding votes: ${reason}`);
      }
      return;
    }
    blockedReason = null;
    const round = readRound();
    const doses = readDoses();
    if (round === null || !doses) return;

    if (round !== lastRound) {
      lastRound = round;
      nextAt = 0;
      roundDeadline = 0;
    }
    const countdown = /^(\d+):([0-5]\d)$/.exec(document.getElementById("timer")?.textContent?.trim() ?? "");
    if (!countdown) {
      nextAt = 0;
      setStatus(`round ${round}: waiting for an active countdown`);
      return;
    }
    const now = Date.now();
    const remainingMs = (Number(countdown[1]) * 60 + Number(countdown[2])) * 1000;
    if (remainingMs <= ROUND_END_BUFFER_MS) {
      nextAt = 0;
      setStatus(`round ${round}: waiting for the next round`);
      return;
    }
    // The display rounds up and can lag a tick; never extend a known deadline.
    if (!roundDeadline) roundDeadline = now + remainingMs - 1000 - TICK_MS;
    if (now >= roundDeadline - ROUND_END_BUFFER_MS) {
      nextAt = 0;
      setStatus(`round ${round}: waiting for the next round`);
      return;
    }
    if (now < nextAt) return;

    const watchedKeys = Object.keys(doses).filter((key) => DIRECTIONS[key] === true);
    const pending = [];
    for (const [key, vote] of Object.entries(decideVotes(doses, shuffle(watchedKeys)))) {
      const row = document.querySelector(`#rows tr[data-key="${CSS.escape(key)}"]`);
      const button = row?.querySelector(`button[data-v="${vote}"]`);
      if (!button) continue;
      if (button.getAttribute("aria-pressed") === "true") continue;
      pending.push({ key, vote, button });
    }
    if (!pending.length) {
      nextAt = 0;
      setStatus(`round ${round}: no votes needed or already selected`);
      return;
    }

    const wasScheduled = nextAt !== 0;
    if (wasScheduled) {
      if (Date.now() >= roundDeadline - ROUND_END_BUFFER_MS) {
        nextAt = 0;
        return;
      }
      const { key, vote, button } = pending.shift();
      button.click();
      const action = `${key} at ${doses[key] > 0 ? "+" : ""}${doses[key].toFixed(2)} → ${vote < 0 ? "lower" : "raise"}`;
      // a click is dispatched, not confirmed: the server's "voted" message is
      // the site's business, so claim only what we did
      setStatus(`round ${round}: clicked ${action}`);
      log(`round ${round}: clicked ${action}`);
    }
    const scheduledAt = Date.now();
    const delay = randomGap(roundDeadline - scheduledAt, pending.length);
    nextAt = delay === null ? 0 : scheduledAt + delay;
    if (!wasScheduled) {
      setStatus(delay === null
        ? `round ${round}: not enough time for another vote`
        : `round ${round}: next vote in ${(delay / 1000).toFixed(1)}s`);
    }
  }

  setInterval(tick, TICK_MS);
  log("userscript loaded");
})();
