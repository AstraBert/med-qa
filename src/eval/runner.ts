import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { bold, green, yellow, red } from "@visulima/colorize";
import { scoreQuestion } from "./score";
import type { EvalQuestion, EvalResult, EvalSummary } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_PATH = resolve(__dirname, "../../evals/medication_eval.json");

// ---------------------------------------------------------------------------
// Mock answer banks (for sanity-checking the scorer)
// ---------------------------------------------------------------------------

const PERFECT_ANSWERS: Record<string, unknown> = {
  "DL-01": [
    "Constipation",
    "Diarrhea",
    "Headache",
    "Throwing up",
    "Upset stomach",
  ],
  "DL-02": "Blood Thinner/Blood Clot Treatment",
  "DL-03": ["Amiodarone", "Digoxin", "Propranalol"],
  "SYN-01": ["Ondansetron", "Promethazine", "Scopolamine"],
  "SYN-02": [
    "Benzapril",
    "Captopril",
    "Enalapril",
    "Lisinopril",
    "Quinapril",
    "Ramipril",
    "Candesartan",
    "Irbesartan",
    "Olmesartan",
    "Valsartan",
    "Losartan",
    "Furosemide",
    "Hydrochlorothiazide",
    "Spironolactone",
  ],
  "SYN-03": false,
  "SYN-04": [
    "Constipation",
    "Diarrhea",
    "Headache",
    "Throwing up",
    "Upset stomach",
  ],
  "BG-01": "Calms Nerves or Makes You Sleepy",
  "BG-02": false,
  "BG-03": "No brand name listed",
  "XC-01": ["Constipation", "Throwing up"],
  "XC-02": ["Dizziness"],
  "XC-03": ["Upset stomach"],
  "NA-01": [],
  "NA-02": false,
  "NA-03": false,
  "AG-01": ["Headache", "Upset stomach"],
  "AG-02": 14,
  "DIS-01":
    "Both. 'Queasiness or Throwing Up' is a category/reason for medicine " +
    "(treated with Ondansetron, Promethazine, Scopolamine), AND 'Queasiness' " +
    "appears as a side effect of Pain Relief medications.",
  "DIS-02": ["Ondansetron", "Promethazine", "Scopolamine"],
};

const WRONG_ANSWERS: Record<string, unknown> = {
  "DL-01": ["Headache"],
  "DL-02": "Pain Relief",
  "DL-03": ["Amiodarone"],
  "SYN-01": ["Ibuprofen"],
  "SYN-02": ["Metoprolol", "Atenolol"],
  "SYN-03": true,
  "SYN-04": ["Dizziness", "Drowsiness"],
  "BG-01": "Pain Relief",
  "BG-02": true,
  "BG-03": "MS Contin",
  "XC-01": ["Headache", "Dizziness"],
  "XC-02": ["Headache", "Constipation"],
  "XC-03": ["Dizziness"],
  "NA-01": ["Acetaminophen", "Tramadol"],
  "NA-02": true,
  "NA-03": true,
  "AG-01": ["Dizziness"],
  "AG-02": 4,
  "DIS-01": "It is a side effect only.",
  "DIS-02": ["Acetaminophen", "Tramadol", "Morphine"],
};

export function getMockAnswers(
  mode: "perfect" | "wrong",
): Record<string, unknown> {
  return mode === "perfect" ? PERFECT_ANSWERS : WRONG_ANSWERS;
}

export async function runEval(
  answers: Record<string, unknown>,
  options: {
    category?: string;
    difficulty?: string;
    verbose?: boolean;
    output?: string;
  } = {},
): Promise<EvalSummary> {
  const { category, difficulty, verbose = true, output } = options;

  const raw = await readFile(EVAL_PATH, "utf-8");
  let questions: EvalQuestion[] = JSON.parse(raw);

  if (category) {
    questions = questions.filter((q) => q.category === category);
  }
  if (difficulty) {
    questions = questions.filter((q) => q.difficulty === difficulty);
  }

  if (questions.length === 0) {
    console.log(yellow("No questions match the filter."));
    return {
      total_questions: 0,
      overall_score: 0,
      by_category: {},
      by_difficulty: {},
      results: [],
    };
  }

  const results: EvalResult[] = await Promise.all(
    questions.map(async (q) => {
      const answer = answers[q.id] ?? "I don't know";
      const result = await scoreQuestion(q, answer);
      return {
        id: q.id,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        expected: q.expected_answer,
        actual: answer,
        score: result.score,
        details: result.details,
      };
    }),
  );

  const categoryScores = new Map<string, number[]>();
  const difficultyScores = new Map<string, number[]>();

  for (const r of results) {
    if (!categoryScores.has(r.category)) categoryScores.set(r.category, []);
    categoryScores.get(r.category)!.push(r.score);

    if (!difficultyScores.has(r.difficulty))
      difficultyScores.set(r.difficulty, []);
    difficultyScores.get(r.difficulty)!.push(r.score);

    if (verbose) {
      const status =
        r.score >= 0.99
          ? green("PASS")
          : r.score > 0
            ? yellow("PART")
            : red("FAIL");
      console.log(
        `  [${status}] ${r.id} (${(r.score * 100).toFixed(1)}%) — ${r.question.slice(0, 60)}...`,
      );
    }
  }

  const allScores = results.map((r) => r.score);
  const overall =
    allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;

  const byCategory: Record<string, number> = {};
  for (const [cat, scores] of [...categoryScores].sort()) {
    byCategory[cat] =
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) /
      10;
  }

  const byDifficulty: Record<string, number> = {};
  for (const [diff, scores] of [...difficultyScores].sort()) {
    byDifficulty[diff] =
      Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) /
      10;
  }

  const summary: EvalSummary = {
    total_questions: questions.length,
    overall_score: Math.round(overall * 1000) / 10,
    by_category: byCategory,
    by_difficulty: byDifficulty,
    results,
  };

  if (verbose) {
    console.log(
      bold(
        `\nOverall: ${summary.overall_score.toFixed(1)}% (${questions.length} questions)\n`,
      ),
    );

    const catCol = Math.max(
      ...Object.keys(byCategory).map((c) => c.length),
      "Category".length,
    );
    console.log(`| ${"Category".padEnd(catCol)} | Score  | Count |`);
    console.log(`|${"-".repeat(catCol + 2)}|--------|-------|`);
    for (const [cat, avg] of Object.entries(byCategory)) {
      const count = categoryScores.get(cat)!.length;
      console.log(
        `| ${cat.padEnd(catCol)} | ${avg.toFixed(1).padStart(5)}% | ${String(count).padStart(5)} |`,
      );
    }

    console.log();
    console.log("| Difficulty | Score  | Count |");
    console.log("|-----------|--------|-------|");
    for (const [diff, avg] of Object.entries(byDifficulty)) {
      const count = difficultyScores.get(diff)!.length;
      console.log(
        `| ${diff.padEnd(9)} | ${avg.toFixed(1).padStart(5)}% | ${String(count).padStart(5)} |`,
      );
    }
  }

  if (output) {
    await writeFile(output, JSON.stringify(summary, null, 2));
    console.log(bold(`\nResults saved to ${output}`));
  }

  return summary;
}
