/*
Processing logic (parsing/screenshotting, embedding, ingestion)
*/
import { LiteParse } from "@llamaindex/liteparse";
import { GoogleGenAI, type ContentEmbedding } from "@google/genai";
import { existsSync } from "fs";
import { RecursiveChunker } from "@chonkiejs/core";
import * as lancedb from "@lancedb/lancedb";
import * as arrow from "apache-arrow";
import fs from "fs/promises";
import pLimit from "p-limit";
import path from "path";
import { bold } from "@visulima/colorize/browser";

const PARSER = new LiteParse();
const SCREENSHOT_DIR = "screenshots";
const SCREENSHOT_FORMAT = "png";
const CONCURRENCY_LIMIT = 5;
export const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const LANCEDB_URI = ".lancedb";
export const TABLE_NAME = "medqa";

type ProcessedPage = {
  pageNumber: number;
  text: string;
  screenshotPath: string;
};

async function parseAndChunk(filePath: string): Promise<Map<number, string[]>> {
  const result = await PARSER.parse(filePath);
  const chunker = await RecursiveChunker.create({
    chunkSize: 4096,
  });
  const pages: Map<number, string[]> = new Map();
  for (const r of result.pages) {
    const chunks = await chunker.chunk(r.text);
    const texts = chunks.map((c) => c.text);
    console.log(
      bold(
        `Produced ${texts.length} chunks from page ${r.pageNum} of ${filePath}`,
      ),
    );
    pages.set(r.pageNum, texts);
  }

  return pages;
}

async function screenshot(
  filePath: string,
  texts: Map<number, string[]>,
  {
    outDir = undefined,
    overwrite = false,
  }: {
    outDir?: string | undefined;
    overwrite?: boolean;
  },
): Promise<Array<ProcessedPage>> {
  const outputDir = outDir ?? SCREENSHOT_DIR;
  await fs.mkdir(outputDir, {
    recursive: true,
  });
  const result = await PARSER.screenshot(filePath);
  console.log(bold(`Finished parsing file ${filePath}`));
  const processed: Array<ProcessedPage> = [];
  for (const r of result) {
    const ext = path.extname(filePath);
    const imagePath = `${outputDir}/${path.basename(filePath, ext)}_page_${r.pageNum}.${SCREENSHOT_FORMAT}`;
    if (existsSync(imagePath) && !overwrite) {
      throw new Error(
        `Cannot write to an existing path (${imagePath}) if overwrite is set to false.`,
      );
    } else {
      await fs.writeFile(imagePath, r.imageBuffer);
    }
    const txts = texts.get(r.pageNum) ?? [];
    for (const txt of txts) {
      processed.push({
        pageNumber: r.pageNum,
        text: txt,
        screenshotPath: imagePath,
      });
    }
  }

  return processed;
}

export function unwrapEmbeddings(
  response: ContentEmbedding[] | undefined,
): Array<number> {
  if (!response) {
    throw new Error("Could not produce embeddings");
  }
  if (response.length == 1) {
    const embd = response.at(0)!;
    if (embd.values) {
      return embd.values;
    } else {
      throw new Error("Embedding is empty");
    }
  } else {
    throw new Error(
      `Expected length for embeddings was 1, got ${response.length}`,
    );
  }
}

async function embedOne(page: ProcessedPage): Promise<Array<number>> {
  const ai = new GoogleGenAI({});
  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [page.text],
  });

  return unwrapEmbeddings(response.embeddings);
}

async function embed(
  pages: Array<ProcessedPage>,
): Promise<Array<Array<number>>> {
  const limit = pLimit(CONCURRENCY_LIMIT);
  const promises = [];
  for (const page of pages) {
    promises.push(limit(() => embedOne(page)));
  }
  const result = await Promise.all(promises);
  return result;
}

export async function connectDb(): Promise<lancedb.Connection> {
  const connectUri = LANCEDB_URI;
  const db = await lancedb.connect(connectUri);
  return db;
}

export async function tableExists(db: lancedb.Connection): Promise<boolean> {
  const tables = await db.tableNames();
  return tables.includes(TABLE_NAME);
}

async function upsertData(
  db: lancedb.Connection,
  pages: Array<ProcessedPage>,
  embeddings: Array<Array<number>>,
): Promise<void> {
  const schema = new arrow.Schema([
    new arrow.Field("id", new arrow.Utf8()),
    new arrow.Field("image", new arrow.Binary()),
    new arrow.Field(
      "vector",
      new arrow.FixedSizeList(
        3072,
        new arrow.Field("item", new arrow.Float32(), true),
      ),
    ),
    new arrow.Field("text", new arrow.Utf8()),
  ]);
  const data = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const embedding = embeddings[i]!;
    const content = await fs.readFile(page.screenshotPath);
    const d = {
      id: page.screenshotPath,
      image: Buffer.from(content),
      vector: embedding,
      text: page.text,
    };
    data.push(d);
  }
  const exists = await tableExists(db);
  if (!exists) {
    const multimodalData = lancedb.makeArrowTable(data, { schema });
    const tbl = await db.createTable(TABLE_NAME, multimodalData, {
      mode: "overwrite",
    });
    await tbl.createIndex("vector", {
      config: lancedb.Index.hnswSq(),
    });
  } else {
    const tbl = await db.openTable(TABLE_NAME);
    await tbl.add(data);
  }
}

export async function pipeline(
  filePath: string,
  {
    screenshotDir = undefined,
    overwriteScreenshots = undefined,
  }: {
    screenshotDir?: string | undefined;
    overwriteScreenshots?: boolean | undefined;
  },
): Promise<void> {
  const texts = await parseAndChunk(filePath);
  const pages = await screenshot(filePath, texts, {
    outDir: screenshotDir,
    overwrite: overwriteScreenshots,
  });
  const embeddings = await embed(pages);
  console.log(bold(`Created ${embeddings.length} embeddings`));
  const db = await connectDb();
  await upsertData(db, pages, embeddings);
  console.log(bold("Finished upserting data to the `.lancedb` folder"));
}
