// Reviewed-turn trigger (/eye and @eye) and calibrated judgment report contract.

const EYE_MARKER = "/eye";

// Matches /eye as a standalone token (rejects x/eye, /eyeline, /eye/foo, /eye.md; allows trailing punctuation).
const EYE_TRIGGER = new RegExp(`(?<![\\w/])${EYE_MARKER}(?![\\w/]|\\.[\\w])`, "i");
const AT_EYE_TRIGGER = /(?<![-\w])@eye(?![\w-])/i;

export const REVIEW_TRIGGER = new RegExp(`${EYE_TRIGGER.source}|${AT_EYE_TRIGGER.source}`, "i");

export const REVIEW_CONTRACT = [
  "[pi-decision-eye] Reviewed turn contract:",
  "- Language: reply in the operator's language; keep code, paths, commands and technical terms verbatim.",
  "- Structure:",
  "  1. Machine-verified facts first (tool outputs, counts, exit codes; assign stable IDs i1, i2, ...; state explicitly if none ran).",
  "  2. One decision table covering every ID named in the report. Spell out the scoring scale in plain language (axis, range, high direction) and include value + level label.",
  "  3. Final column: decided action (DONE / BLOCKED / NEXT / DEFER).",
  "  4. Threshold line stating the decision boundary.",
  "  5. Priority order of open IDs matching the table rows (no unindexed items).",
  "  6. One single confirmation question at the end.",
  "- No preamble. Write gate evaluates diffs against this request text.",
].join("\n");
