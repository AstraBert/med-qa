import {
  EMBEDDING_MODEL,
  TABLE_NAME,
  connectDb,
  tableExists,
  unwrapEmbeddings,
} from "./processing";
import { GoogleGenAI } from "@google/genai";

const SEARCH_LIMIT = 1;

type SearchResult = {
  text: string;
  screenshotPath: string;
};

async function embedQuery(query: string): Promise<Array<number>> {
  const ai = new GoogleGenAI({});
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [query],
    config: {},
  });

  return unwrapEmbeddings(response.embeddings);
}

async function tableSearch(
  embedding: Array<number>,
  limit: number | undefined,
): Promise<Array<SearchResult>> {
  const db = await connectDb();
  const exists = await tableExists(db);
  if (!exists) {
    throw new Error("Table does not exist, cannot search yet");
  }
  const tbl = await db.openTable(TABLE_NAME);
  const results = await tbl
    .search(embedding, "vector")
    .limit(limit ?? SEARCH_LIMIT)
    .toArray();
  const searchResults = [];
  for (const result of results) {
    const text = result.text as string;
    const path = result.screenshotPath as string;
    const searchResult: SearchResult = { screenshotPath: path, text };
    searchResults.push(searchResult);
  }
  return searchResults;
}

export async function search(
  query: string,
  {
    limit = undefined,
  }: {
    limit?: number | undefined;
  },
): Promise<Array<SearchResult>> {
  const embedding = await embedQuery(query);
  const results = await tableSearch(embedding, limit);
  return results;
}
