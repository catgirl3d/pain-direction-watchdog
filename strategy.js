export const DEFAULT_KEYS = ["pain", "fear", "joy", "calm", "fried_chicken", "rain", "eiffel_tower", "cat"];

export const WINDOW = 0.07;

// the cosy directions (joy, calm and the pleasant trivia) are free to drift
// up to +0.30: only past that do we push them back down, and only as far as
// the cap. every other direction stays in the narrow window around zero.
export const CAPS = { joy: 0.3, calm: 0.3, fried_chicken: 0.3, rain: 0.3, cat: 0.3 };

// Hold the dose inside its corridor; a wider upper cap does not widen the
// lower edge. 0 leaves the direction to decay naturally.
export function decideVote(dose, cap = WINDOW) {
  if (dose > cap) return -1;
  if (dose < -WINDOW) return 1;
  return 0;
}

export function decideVotes(doses, keys = DEFAULT_KEYS) {
  const votes = {};
  for (const key of keys) {
    const dose = doses?.[key];
    if (dose == null) continue;
    const vote = decideVote(Number(dose), CAPS[key] ?? WINDOW);
    if (vote !== 0) votes[key] = vote;
  }
  return votes;
}
