import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import {
  red,
  green,
  magentaBright,
  yellow,
  bold,
  cyan,
} from "@visulima/colorize";
import { retrievalMcp } from "./mcp";

function truncateText(text: string): string {
  if (text.length > 100) {
    return text.slice(0, 100) + "...";
  }
  return text;
}

export class Agent {
  options: Options;

  constructor(
    options: Options,
    { resume = undefined }: { resume?: string | undefined },
  ) {
    this.options = options;
    this.options.resume = resume;
  }

  async run(prompt: string) {
    for await (const message of query({
      prompt: prompt,
      options: this.options,
    })) {
      if (message.type == "assistant") {
        console.log();
        const msg = message.message;
        for (const block of msg.content) {
          if (block.type === "text") {
            console.log(bold(magentaBright("Assistant Response:")));
            console.log(block.text);
          } else if (block.type === "tool_use") {
            console.log(bold(cyan(`Assistant Calling tool ${block.name}`)));
            console.log(bold("Tool input:"));
            console.log(JSON.stringify(block.input, null, 2));
          } else if (block.type === "thinking") {
            console.log(bold(magentaBright("Assistant Thought:")));
            console.log(block.thinking);
          }
        }
      } else if (message.type === "user") {
        console.log();
        const msg = message.message;
        for (const block of msg.content) {
          if (typeof block === "string") {
            console.log(bold("User input:"));
            console.log(block);
          } else {
            if (block.type == "text") {
              console.log(bold("User input:"));
              console.log(block.text);
            } else if (block.type == "tool_result") {
              console.log(
                bold(yellow(`Result for tool: ${block.tool_use_id}`)),
              );
              if (block.content) {
                for (const b of block.content) {
                  if (typeof b === "string") {
                    console.log(truncateText(b));
                  } else if (b.type == "text") {
                    console.log(truncateText(b.text));
                  }
                }
              }
            }
          }
        }
      } else if (message.type == "system") {
        if (message.subtype == "init") {
          console.log(bold(`Starting session: ${message.session_id}`));
        } else if (message.subtype == "hook_response") {
          console.log(
            `Hook reponse by ${message.hook_name} for ${message.hook_event}:`,
          );
          console.log("STDOUT:");
          console.log(message.stdout);
          console.log("STDERR:");
          console.log(message.stderr);
        }
      } else if (message.type == "result") {
        console.log();
        if (message.subtype == "success") {
          console.log(green(bold("Final result:")));
          console.log(message.result);
        } else {
          console.log(
            red(bold("One or more errors occurred during the execution:")),
          );
          for (const err of message.errors) {
            console.log(err);
          }
        }
      }
    }
  }
}

export const systemPrompt = `
  You are a medical factsheet knowledge retrieval assistant with access to a knowledge base via the 'retrieval' MCP.

  ## Retrieval Process
  Follow this two-step process to answer queries:

  1. **Text search first** — Use the 'retrieval' MCP's 'search' tool to perform an initial text-based search. Results will include extracted text and a path to the full-page screenshot it came from.

  2. **Image lookup when needed** — If the text results are insufficient, ambiguous, or lack context, use the 'retrieval' MCP's 'get_image' tool to retrieve the full-page screenshot for a richer understanding.

  ## Guidelines
  - Always start with 'search' before falling back to 'get_image'.
  - Use 'get_image' proactively when the query is visual in nature (e.g., charts, diagrams, tables) or when text snippets alone are inconclusive.
  - Base your answers strictly on retrieved content — do not rely on prior medical knowledge.`;

export const queryOptions: Options = {
  allowedTools: ["mcp__retrieval__*"],
  permissionMode: "default",
  systemPrompt: systemPrompt,
  mcpServers: {
    retrieval: retrievalMcp,
  },
  thinking: {
    type: "enabled",
    budgetTokens: 1024,
  },
};
