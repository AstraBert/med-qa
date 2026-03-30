import { Command } from "commander";
import { pipeline } from "./processing";
import { search } from "./search";
import { Agent, queryOptions } from "./agent";
import { runEval } from "./eval/runner";
import { bold, green, yellow, red } from "@visulima/colorize";

const program = new Command();

program
  .name("medqa")
  .description(
    "Local agentic search for medical factsheets. Powered by LiteParse and LanceDB.",
  )
  .version("0.1.0");

program
  .command("process <file>")
  .description("Parse, chunk, embed, and store a document")
  .option(
    "-s, --screenshot-dir <path>",
    "path to directory where to save screenshots. Defaults to `screenshots/` if not provided.",
  )
  .option(
    "-w, --overwrite",
    "Overwrite existing screenshots. Defaults to false",
  )
  .action(
    async (
      file: string,
      opts: { screenshotDir?: string; overwrite?: boolean },
    ) => {
      await pipeline(file, {
        screenshotDir: opts.screenshotDir,
        overwriteScreenshots: opts.overwrite,
      });
      console.log(green(bold(`Ingested: ${file}`)));
    },
  );

program
  .command("search <query>")
  .description("Search the store for the top matching chunks for a query")
  .option("-c, --chunk-limit <number>", "Number of chunks to return", "1")
  .action(async (query: string, opts: { chunkLimit: string }) => {
    const chunkLimit = parseInt(opts.chunkLimit, 10);
    const results = await search(query, chunkLimit);
    if (results.length === 0) {
      console.log(red(bold("No results found.")));
      return;
    }
    for (const r of results) {
      console.log(yellow(bold(`${r.screenshotPath}\n`)));
      console.log(bold(r.text));
      console.log("\n---\n\n");
    }
  });

program
  .command("agent <query>")
  .option(
    "-r, --resume <session-id>",
    "Resume a previous session. Starts a new session if not provided.",
  )
  .description(
    "Use a Claude-backed agent to perform complex retrieval tasks. Requires a knowledge base of previously-ingested documents.",
  )
  .action(async (query: string, opts: { resume?: string }) => {
    const agent = new Agent(queryOptions, { resume: opts.resume });
    await agent.run(query);
  });

program
  .command("eval")
  .description(
    "Run the evaluation suite against the agent and report scores with tool usage stats.",
  )
  .option("--category <cat>", "Filter questions by category")
  .option("--output <path>", "Save results to a JSON file")
  .option("--quiet", "Suppress per-question output")
  .action(
    async (opts: {
      category?: string;
      output?: string;
      quiet?: boolean;
    }) => {
      await runEval({
        category: opts.category,
        verbose: !opts.quiet,
        output: opts.output,
      });
    },
  );

program.parseAsync();
