import { basename } from "node:path";

const labelFor = (file) => basename(file).replace(/\.[^.]+$/, "") || basename(file);

// Turns CLI arguments and environment into a list of instances to start.
// Each named file carries one session, so `npm start -- a.txt b.txt` runs two
// independent instances with their own session and their own vote.
export function sessionSpecs(args = [], env = process.env) {
  const files = args.filter(Boolean);
  if (files.length) return files.map((file) => ({ label: labelFor(file), file }));
  if (env.CS_SESSION) return [{ label: "env", session: env.CS_SESSION }];
  if (env.CS_SESSION_FILE) return [{ label: labelFor(env.CS_SESSION_FILE), file: env.CS_SESSION_FILE }];
  return [{ label: "session", file: "session.txt" }];
}
