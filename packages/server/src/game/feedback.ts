import type { GuessDiff } from "@holodle/shared";

// Fixed attribute order for the six-character E/P/X feedback-pattern key,
// e.g. "EXXPEX". This order is a wire contract shared by:
//   - db/client.ts::getNextGuessByFeedback (admin stats aggregation)
//   - game/bestGuess.ts (the Best Guess Explorer endpoint)
//   - the toggle-cell order in admin.html's two explorer UIs
// Changing it invalidates nothing stored (keys are derived per request), but
// all three must move together.
export const FEEDBACK_ATTRS: Array<keyof Omit<GuessDiff, "talentId">> = [
  "branch",
  "group",
  "penlightColor",
  "archetype",
  "height",
  "birthMonth",
];

// Encodes one guess's six cell states as an E/P/X pattern key.
export function feedbackKey(guess: GuessDiff): string {
  return FEEDBACK_ATTRS.map((attr) => {
    const st = guess[attr]?.state;
    return st === "equal" ? "E" : st === "partial" ? "P" : "X";
  }).join("");
}
