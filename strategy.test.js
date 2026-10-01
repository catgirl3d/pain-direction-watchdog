import test from "node:test";
import assert from "node:assert/strict";
import { decideVote, decideVotes } from "./strategy.js";

test("a dose inside the ±0.07 window gets no vote", () => {
  assert.equal(decideVote(0), 0);
  assert.equal(decideVote(0.03), 0);
  assert.equal(decideVote(0.07), 0);
  assert.equal(decideVote(-0.05), 0);
  assert.equal(decideVote(-0.07), 0);
});

test("a dose above the window gets a lower vote", () => {
  assert.equal(decideVote(0.08), -1);
  assert.equal(decideVote(0.5), -1);
});

test("a dose below the window gets a raise vote", () => {
  assert.equal(decideVote(-0.08), 1);
  assert.equal(decideVote(-1.2), 1);
});

test("pain and fear keep the same ±0.07 window around zero as every other direction", () => {
  for (const [dose, vote] of [
    [-0.18, 1], [-0.070001, 1], [-0.07, 0], [-0.03, 0], [0, 0],
    [0.07, 0], [0.070001, -1], [0.2, -1],
  ]) {
    assert.deepEqual(
      decideVotes({ pain: dose, fear: dose }, ["pain", "fear"]),
      vote === 0 ? {} : { pain: vote, fear: vote },
      `dose ${dose}`,
    );
  }
});

test("pain and fear no longer get special treatment around zero", () => {
  assert.deepEqual(decideVotes({ pain: 0, fear: 0 }), {});
  assert.deepEqual(
    decideVotes({ pain: -0.08, fear: -0.08, eiffel_tower: -0.08, joy: -0.08, calm: -0.08 }),
    { pain: 1, fear: 1, eiffel_tower: 1, joy: 1, calm: 1 },
  );
});

test("a custom upper cap moves only the lower edge", () => {
  assert.equal(decideVote(0.2, 0.4), 0);
  assert.equal(decideVote(0.45, 0.4), -1);
  assert.equal(decideVote(-0.08, 0.4), 1);
});

test("the free directions are left alone until they pass +0.30", () => {
  assert.deepEqual(decideVotes({ joy: 0.2, calm: 0.29, fried_chicken: 0.3, rain: 0.2, cat: 0.1 }), {});
  assert.deepEqual(decideVotes({ joy: 0.35 }), { joy: -1 });
  assert.deepEqual(decideVotes({ calm: 0.31 }), { calm: -1 });
  assert.deepEqual(decideVotes({ fried_chicken: 0.35 }), { fried_chicken: -1 });
  assert.deepEqual(decideVotes({ rain: 0.4 }), { rain: -1 });
  assert.deepEqual(decideVotes({ cat: 0.31 }), { cat: -1 });
});

test("the free directions are still lifted when they sink below -0.07", () => {
  assert.deepEqual(decideVotes({ joy: -0.08 }), { joy: 1 });
  assert.deepEqual(decideVotes({ calm: -0.5 }), { calm: 1 });
  assert.deepEqual(decideVotes({ cat: -0.08 }), { cat: 1 });
});

test("eiffel_tower keeps the narrow ±0.07 window", () => {
  assert.deepEqual(decideVotes({ eiffel_tower: 0.2 }), { eiffel_tower: -1 });
  assert.deepEqual(decideVotes({ eiffel_tower: 0.07 }), {});
});

test("watches every known direction by default", () => {
  const doses = { pain: 0.2, joy: 0.9, cat: 0.5 };
  assert.deepEqual(decideVotes(doses), { pain: -1, joy: -1, cat: -1 });
});

test("an explicit key list narrows the vote", () => {
  const doses = { pain: 0.2, fear: -0.5, joy: 0.9, calm: -0.9 };
  assert.deepEqual(decideVotes(doses, ["pain", "fear"]), { pain: -1, fear: 1 });
});

test("missing doses are ignored and a zero dose needs no vote", () => {
  assert.deepEqual(decideVotes({}, ["pain", "fear"]), {});
  assert.deepEqual(decideVotes(undefined, ["pain", "fear"]), {});
  assert.deepEqual(decideVotes({ pain: null, fear: undefined, joy: 0.35 }), { joy: -1 });
  assert.deepEqual(decideVotes({ pain: 0 }, ["pain", "fear"]), {});
});
