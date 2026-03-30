import { Command } from "commander";
import { pipeline } from "./processing";
import { search } from "./search";
import { Agent, queryOptions } from "./agent";
import { bold, green, red, yellow } from "@visulima/colorize";

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
  .description("Search the store for chunks matching a query")
  .option("-l, --limit <number>", "maximum number of results", parseInt)
  .action(async (query: string, opts: { limit?: number }) => {
    const results = await search(query, { limit: opts.limit });
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

program.parseAsync();
