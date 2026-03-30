import Anthropic from "@anthropic-ai/sdk";
import type { EvalQuestion, ScoreResult } from "./types";

function normalize(text: string): string {
  return text
    .replace(/\s*\(.*?\)/g, "") // strip parenthetical suffixes like "(Zofran®)"
    .replace(/®/g, "")
    .trim()
    .toLowerCase();
}

export function scoreSet(
  expected: string[],
  actual: string[],
  acceptableAliases?: Record<string, string[]>,
): { precision: number; recall: number; f1: number } {
  if (expected.length === 0 && actual.length === 0) {
    return { precision: 1.0, recall: 1.0, f1: 1.0 };
  }
  if (expected.length === 0) {
    return { precision: 0.0, recall: 1.0, f1: 0.0 };
  }
  if (actual.length === 0) {
    return { precision: 0.0, recall: 0.0, f1: 0.0 };
  }

  const accepted = new Map<string, Set<string>>();
  for (const item of expected) {
    const forms = new Set<string>([normalize(item)]);
    if (acceptableAliases) {
      for (const alias of acceptableAliases[item] ?? []) {
        forms.add(normalize(alias));
      }
    }
    accepted.set(normalize(item), forms);
  }

  const allAcceptedForms = new Map<string, string>();
  for (const [canon, forms] of accepted) {
    for (const form of forms) {
      allAcceptedForms.set(form, canon);
    }
  }

  const matchedExpected = new Set<string>();
  let truePositives = 0;
  for (const item of actual) {
    const norm = normalize(item);
    const canon = allAcceptedForms.get(norm);
    if (canon !== undefined && !matchedExpected.has(canon)) {
      matchedExpected.add(canon);
      truePositives++;
    }
  }

  const precision = actual.length > 0 ? truePositives / actual.length : 0.0;
  const recall = expected.length > 0 ? truePositives / expected.length : 0.0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0.0;
  return { precision, recall, f1 };
}

export function scoreExactMatch(
  expected: string,
  actual: string,
  acceptableAnswers?: string[],
): number {
  const normActual = normalize(actual);
  const normExpected = normalize(expected);

  if (normActual === normExpected) return 1.0;

  if (acceptableAnswers) {
    for (const ans of acceptableAnswers) {
      if (normalize(ans) === normActual) return 1.0;
      if (normActual.includes(normalize(ans))) return 0.5;
    }
  }

  if (normExpected.includes(normActual) || normActual.includes(normExpected)) {
    return 0.5;
  }

  return 0.0;
}

export function scoreBoolean(expected: boolean, actual: unknown): number {
  if (typeof actual === "boolean") {
    return actual === expected ? 1.0 : 0.0;
  }
  if (typeof actual === "string") {
    const norm = normalize(actual);
    const truthy = ["true", "yes", "correct", "it is", "they do"];
    const falsy = [
      "false",
      "no",
      "incorrect",
      "it is not",
      "they do not",
      "it doesn't",
      "they don't",
    ];
    if (truthy.includes(norm)) return expected ? 1.0 : 0.0;
    if (falsy.includes(norm)) return expected ? 0.0 : 1.0;
  }
  return 0.0;
}

export function scoreNumber(
  expected: number,
  actual: unknown,
  tolerance: number = 0,
): number {
  let actualNum: number;
  if (typeof actual === "number") {
    actualNum = actual;
  } else if (typeof actual === "string") {
    const parsed = parseFloat(actual);
    if (!isNaN(parsed)) {
      actualNum = parsed;
    } else {
      const match = actual.match(/\d+/);
      if (match) {
        actualNum = parseFloat(match[0]);
      } else {
        return 0.0;
      }
    }
  } else {
    return 0.0;
  }
  return Math.abs(actualNum - expected) <= tolerance ? 1.0 : 0.0;
}

function heuristicFreeTextScore(expected: string, actual: string): number {
  const expectedWords = new Set(
    normalize(expected).split(/\s+/).filter(Boolean),
  );
  const actualWords = new Set(normalize(actual).split(/\s+/).filter(Boolean));
  if (expectedWords.size === 0) return actualWords.size === 0 ? 1.0 : 0.0;
  let overlap = 0;
  for (const word of expectedWords) {
    if (actualWords.has(word)) overlap++;
  }
  return overlap / expectedWords.size;
}

function buildJudgePrompt(
  expected: string,
  actual: string,
  rubric: Record<string, string>,
): string {
  const rubricText = Object.entries(rubric)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return (
    "You are an eval judge. Score the following answer against the expected " +
    "answer and rubric.\n\n" +
    `Expected answer: ${expected}\n\n` +
    `Actual answer: ${actual}\n\n` +
    `Scoring rubric:\n${rubricText}\n\n` +
    "Return ONLY a JSON object with two keys:\n" +
    '- "score": a float between 0.0 and 1.0\n' +
    '- "explanation": a brief explanation of the score\n\n' +
    'Example: {"score": 0.5, "explanation": "Identified one role but missed the other."}'
  );
}

function parseJudgeResponse(content: string): number {
  try {
    const result = JSON.parse(content);
    return Number(result.score);
  } catch {
    const match = content.match(/(\d+\.?\d*)/);
    if (match) return Math.min(parseFloat(match[1]), 1.0);
    return 0.0;
  }
}

export async function scoreFreeTextWithLlm(
  expected: string,
  actual: string,
  rubric: Record<string, string>,
  model: string = "claude-sonnet-4-6",
): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    return heuristicFreeTextScore(expected, actual);
  }

  const client = new Anthropic({ apiKey });
  const prompt = buildJudgePrompt(expected, actual, rubric);

  const response = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";
  return parseJudgeResponse(content);
}

export async function scoreQuestion(
  question: EvalQuestion,
  actualAnswer: unknown,
): Promise<ScoreResult> {
  const { answer_type, expected_answer } = question;

  if (answer_type === "set") {
    let actual: string[];
    if (typeof actualAnswer === "string") {
      try {
        actual = JSON.parse(actualAnswer);
      } catch {
        actual = actualAnswer
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else {
      actual = actualAnswer as string[];
    }
    const result = scoreSet(
      expected_answer as string[],
      actual,
      question.acceptable_aliases,
    );
    return { score: result.f1, details: result };
  }

  if (answer_type === "exact_match") {
    const s = scoreExactMatch(
      expected_answer as string,
      String(actualAnswer),
      question.acceptable_answers,
    );
    return {
      score: s,
      details: {
        match_type: s === 1.0 ? "exact" : s > 0 ? "partial" : "none",
      },
    };
  }

  if (answer_type === "boolean") {
    const s = scoreBoolean(expected_answer as boolean, actualAnswer);
    return {
      score: s,
      details: { expected: expected_answer, got: actualAnswer },
    };
  }

  if (answer_type === "number") {
    const s = scoreNumber(expected_answer as number, actualAnswer);
    return {
      score: s,
      details: { expected: expected_answer, got: actualAnswer },
    };
  }

  if (answer_type === "free_text") {
    let rubric = question.scoring_rubric ?? {};
    if (Object.keys(rubric).length === 0) {
      rubric = { full_marks: "Correct and complete", zero_marks: "Incorrect" };
    }
    const s = await scoreFreeTextWithLlm(
      String(expected_answer),
      String(actualAnswer),
      rubric,
    );
    return { score: s, details: { judge: "llm" } };
  }

  return {
    score: 0.0,
    details: { error: `Unknown answer_type: ${answer_type}` },
  };
}
