// Human-friendly progress dashboard for a diary day.
// Pure rendering: accepts the shape returned by readDay() (totals, goals,
// incomplete_nutrients) and returns a text block with aligned progress bars.

const LABELS = {
  en: {
    energy_kcal: ["🔥", "Calories", ""],
    protein_g: ["💪", "Protein", "g"],
    fat_g: ["🥑", "Fat", "g"],
    fiber_g: ["🌾", "Fiber", "g"],
  },
  ru: {
    energy_kcal: ["🔥", "Ккал", ""],
    protein_g: ["💪", "Белок", "г"],
    fat_g: ["🥑", "Жиры", "г"],
    fiber_g: ["🌾", "Клетчатка", "г"],
  },
};

const NO_GOAL = { en: "goal not set", ru: "цель не задана" };
const ORDER = ["energy_kcal", "protein_g", "fat_g", "fiber_g"];

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Round half-up to `digits` decimals; when floor is true, always round down so
// a lower-bound marker (≥) never overstates the known value.
function rounded(value, digits, floor = false) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const result = floor ? Math.floor(scaled) : Math.round(scaled);
  return result / factor;
}

function decimalText(value, digits, separator, floor = false) {
  const number = rounded(value, digits, floor);
  let text = String(number);
  if (digits === 0) return text;
  if (!text.includes(".")) text += ".0";
  text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text.replace(".", separator);
}

function exactText(value, separator) {
  let text = String(value);
  if (!text.includes(".")) return text;
  text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text.replace(".", separator);
}

function progress(current, target, minimum) {
  const ratio = target > 0 ? current / target : 0;
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  const percent = target > 0
    ? (minimum ? Math.floor(ratio * 100) : Math.round(ratio * 100))
    : 0;
  return ["█".repeat(filled) + "░".repeat(10 - filled), percent];
}

function lineWithGoal([icon, label, unit], current, target, minimum, separator) {
  const [bar, percent] = progress(current, target, minimum);
  const marker = minimum ? "≥" : "";
  const digits = label === "Calories" || label === "Ккал" ? 0 : 1;
  const value = `${marker}${decimalText(current, digits, separator, minimum)} / ${exactText(target, separator)}`;
  const withUnit = unit ? `${value} ${unit}` : value;
  return `${icon} ${label.padEnd(10)} ${bar}  ${withUnit} · ${marker}${percent}%`;
}

function lineWithoutGoal([icon, label, unit], current, minimum, language, separator) {
  const marker = minimum ? "≥" : "";
  const digits = label === "Calories" || label === "Ккал" ? 0 : 1;
  const displayUnit = unit || (language === "ru" ? "ккал" : "kcal");
  const value = `${marker}${decimalText(current, digits, separator, minimum)} ${displayUnit}`;
  return `${icon} ${label.padEnd(10)} ${value} · ${NO_GOAL[language]}`;
}

export function renderProgress(day, language = "en") {
  const labels = LABELS[language] ?? LABELS.en;
  const separator = language === "ru" ? "," : ".";
  const totals = day.totals ?? {};
  const goals = day.goals ?? {};
  const incomplete = new Set(day.incomplete_nutrients ?? []);

  const lines = [];
  for (const nutrient of ORDER) {
    const [icon, label, unit] = labels[nutrient];
    const current = isNumber(totals[nutrient]) ? totals[nutrient] : 0;
    const target = goals[nutrient];
    const minimum = incomplete.has(nutrient);
    if (isNumber(target) && target > 0) {
      lines.push(lineWithGoal([icon, label, unit], current, target, minimum, separator));
    } else {
      lines.push(lineWithoutGoal([icon, label, unit], current, minimum, language, separator));
    }
  }
  return lines.join("\n");
}