import {
  EMBEDDING_MODEL,
  TABLE_NAME,
  connectDb,
  tableExists,
  unwrapEmbeddings,
} from "./processing";
import { GoogleGenAI } from "@google/genai";

const DEFAULT_CHUNK_LIMIT = 1;

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
  limit: number,
): Promise<Array<SearchResult>> {
  const db = await connectDb();
  const exists = await tableExists(db);
  if (!exists) {
    throw new Error("Table does not exist, cannot search yet");
  }
  const tbl = await db.openTable(TABLE_NAME);
  const results = await tbl
    .search(embedding, "vector")
    .limit(limit)
    .toArray();
  const searchResults = [];
  for (const result of results) {
    const text = result.text as string;
    const path = result.id as string;
    const searchResult: SearchResult = { screenshotPath: path, text };
    searchResults.push(searchResult);
  }
  return searchResults;
}

export async function getImageBase64(path: string): Promise<string> {
  const db = await connectDb();
  const exists = await tableExists(db);
  if (!exists) {
    throw new Error("Table does not exist, cannot search yet");
  }
  const tbl = await db.openTable(TABLE_NAME);
  const item = await tbl
    .query()
    .where(`id = '${path}'`)
    .select(["image"])
    .limit(1)
    .toArray();
  if (item.length != 1) {
    throw new Error("Expected to retrieve exactly one image");
  }
  const arr = item[0]!.image as Uint8Array;
  const buf = Buffer.from(arr);
  return buf.toString("base64");
}

export async function search(
  query: string,
  chunkLimit: number = DEFAULT_CHUNK_LIMIT,
): Promise<Array<SearchResult>> {
  const embedding = await embedQuery(query);
  const results = await tableSearch(embedding, chunkLimit);
  return results;
}
