import test from "node:test";
import assert from "node:assert/strict";
import { sessionSpecs } from "./sessions.js";

test("every named file becomes its own labelled instance", () => {
  assert.deepEqual(sessionSpecs(["sessions/a.txt", "b.txt"], {}), [
    { label: "a", file: "sessions/a.txt" },
    { label: "b", file: "b.txt" },
  ]);
});

test("CS_SESSION is used when no files are given", () => {
  assert.deepEqual(sessionSpecs([], { CS_SESSION: "abc" }), [{ label: "env", session: "abc" }]);
});

test("CS_SESSION_FILE is a labelled fallback", () => {
  assert.deepEqual(sessionSpecs([], { CS_SESSION_FILE: "sessions/kitchen.txt" }), [
    { label: "kitchen", file: "sessions/kitchen.txt" },
  ]);
});

test("with nothing given, session.txt is the single instance", () => {
  assert.deepEqual(sessionSpecs([], {}), [{ label: "session", file: "session.txt" }]);
});
