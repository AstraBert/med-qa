import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { bold, green, yellow, red, cyan } from "@visulima/colorize";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { scoreQuestion } from "./score";
import { createQueryOptions } from "../agent";
import type { EvalQuestion, EvalResult, EvalSummary, ToolStats } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_PATH = resolve(__dirname, "gold.json");

// ---------------------------------------------------------------------------
// Structured output format instructions appended to each agent prompt
// ---------------------------------------------------------------------------

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  set: '\n\nIMPORTANT: Respond with ONLY a JSON array of strings. Example: ["item1", "item2"]. If the answer is an empty set, return []. No explanation, no markdown — just the JSON array.',
  boolean:
    "\n\nIMPORTANT: Respond with ONLY the word true or false. No explanation, no markdown — just the boolean.",
  number:
    "\n\nIMPORTANT: Respond with ONLY a single number. No explanation, no markdown — just the number.",
  exact_match:
    "\n\nIMPORTANT: Respond with ONLY the answer as a short string. No explanation, no markdown.",
  free_text:
    "\n\nIMPORTANT: Respond with ONLY the direct answer in one sentence. No markdown, no emojis, no elaboration.",
};

// ---------------------------------------------------------------------------
// Run a single question through the agent and track tool usage
// ---------------------------------------------------------------------------

async function askAgent(
  question: string,
  answerType: string,
): Promise<{ answer: string; toolStats: ToolStats }> {
  const stats: ToolStats = {
    search_calls: 0,
    get_image_calls: 0,
  };
  let finalResult = "";
  const formatSuffix = FORMAT_INSTRUCTIONS[answerType] ?? "";

  for await (const message of query({
    prompt: question + formatSuffix,
    options: createQueryOptions(),
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          if (block.name === "mcp__retrieval__search") {
            stats.search_calls++;
          } else if (block.name === "mcp__retrieval__get_image") {
            stats.get_image_calls++;
          }
        }
      }
    } else if (message.type === "result" && message.subtype === "success") {
      finalResult = message.result;
    }
  }

  return { answer: finalResult, toolStats: stats };
}

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

export async function runEval(
  options: {
    category?: string;
    verbose?: boolean;
    output?: string;
  } = {},
): Promise<EvalSummary> {
  const { category, verbose = true, output } = options;

  const raw = await readFile(EVAL_PATH, "utf-8");
  let questions: EvalQuestion[] = JSON.parse(raw);

  if (category) {
    questions = questions.filter((q) => q.category === category);
  }

  if (questions.length === 0) {
    console.log(yellow("No questions match the filter."));
    return {
      total_questions: 0,
      overall_score: 0,
      by_category: {},
      results: [],
    };
  }

  let completed = 0;
  const total = questions.length;

  const results: EvalResult[] = (await Promise.all(
    questions.map(async (q) => {
      const { answer, toolStats } = await askAgent(q.question, q.answer_type);
      const result = await scoreQuestion(q, answer);
      completed++;
      if (verbose) {
        process.stdout.write(`\r  Running… ${completed}/${total} complete`);
      }
      return {
        id: q.id,
        category: q.category,
        question: q.question,
        expected: q.expected_answer,
        actual: answer,
        score: result.score,
        details: result.details,
        tool_stats: toolStats,
      };
    }),
  )).sort((a, b) => a.id.localeCompare(b.id));

  if (verbose) {
    process.stdout.write("\r" + " ".repeat(40) + "\r");
  }

  if (verbose) {
    for (const r of results) {
      const ts = r.tool_stats!;
      const status =
        r.score >= 0.99
          ? green("PASS")
          : r.score > 0
            ? yellow("PART")
            : red("FAIL");
      const total = ts.search_calls + ts.get_image_calls;
      const imgTag = ts.get_image_calls > 0 ? cyan(" [img]") : "";
      console.log(
        `  [${status}] ${r.id} (${(r.score * 100).toFixed(1)}%) — tools: ${total} (search: ${ts.search_calls}, image: ${ts.get_image_calls})${imgTag}`,
      );
    }
  }

  const categoryScores = new Map<string, number[]>();

  for (const r of results) {
    if (!categoryScores.has(r.category)) categoryScores.set(r.category, []);
    categoryScores.get(r.category)!.push(r.score);
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

  const summary: EvalSummary = {
    total_questions: questions.length,
    overall_score: Math.round(overall * 1000) / 10,
    by_category: byCategory,
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

    // Tool usage summary
    const withImage = results.filter(
      (r) => r.tool_stats && r.tool_stats.get_image_calls > 0,
    );
    const totalSearchCalls = results.reduce(
      (sum, r) => sum + (r.tool_stats?.search_calls ?? 0),
      0,
    );
    const totalImageCalls = results.reduce(
      (sum, r) => sum + (r.tool_stats?.get_image_calls ?? 0),
      0,
    );

    console.log(bold("\n--- Tool Usage ---"));
    console.log(`Total tool calls: ${totalSearchCalls + totalImageCalls}`);
    console.log(
      `  search: ${totalSearchCalls}  |  get_image: ${totalImageCalls}`,
    );
    console.log(
      `Questions using get_image: ${withImage.length}/${results.length}`,
    );
    if (withImage.length > 0) {
      console.log(`  IDs: ${withImage.map((r) => r.id).join(", ")}`);
    }
  }

  if (output) {
    await writeFile(output, JSON.stringify(summary, null, 2));
    console.log(bold(`\nResults saved to ${output}`));
  }

  return summary;
}
