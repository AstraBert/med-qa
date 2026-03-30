import * as z from "zod";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getImageBase64, search } from "./search";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";


export const getImageSchemaShape = {
  imagePath: z.string().describe("Path of the image to read"),
};

export const searchSchemaShape = {
  query: z.string().describe("Search query"),
};

export const searchSchema = z.object(searchSchemaShape);
export const getImageSchema = z.object(getImageSchemaShape);

async function searchTool(
  input: z.infer<typeof searchSchema>,
): Promise<CallToolResult> {
  const results = await search(input.query, {});
  const contents: { type: "text"; text: string }[] = [];
  for (const result of results) {
    const text = `FULL PAGE SCREENSHOT PATH: ${result.screenshotPath}\n\nCONTENT:\n${result.text}`;
    contents.push({ type: "text", text });
  }
  return { content: contents };
}

async function getImageTool(
  input: z.infer<typeof getImageSchema>,
): Promise<CallToolResult> {
  const buffer = await getImageBase64(input.imagePath);
  return {
    content: [
      {
        type: "image",
        data: buffer,
        mimeType: "image/png",
      },
    ],
  };
}

const mcpSearchTool = tool(
  "search",
  "Search a knowledge base to find the answer to a user's question.",
  searchSchemaShape,
  searchTool,
);

const mcpGetImageTool = tool(
  "get_image",
  "Get an image associated with text content retrieved through the search tool. Useful when you want to expand the search content beyond text and retrieve the full page screenshot.",
  getImageSchemaShape,
  getImageTool,
);

export const retrievalMcp = createSdkMcpServer({
  name: "retrieval",
  version: "1.0.0",
  tools: [mcpSearchTool, mcpGetImageTool],
});

export function createRetrievalMcp() {
  return createSdkMcpServer({
    name: "retrieval",
    version: "1.0.0",
    tools: [mcpSearchTool, mcpGetImageTool],
  });
}
