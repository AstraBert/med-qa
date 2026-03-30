# med-qa

A local CLI for ingesting, searching, and querying medical factsheets using vector embeddings and an AI-backed agent.

Documents are parsed and converted to page-level screenshots by [LiteParse](https://github.com/run-llama/liteparse), chunked with [Chonkie](https://chonkie.ai), embedded with [Google's Gemini embedding model](https://ai.google.dev/gemini-api/docs/embeddings#multimodal), and stored in a local [LanceDB](https://lancedb.com) vector database. A [Claude](https://platform.claude.com/docs/en/agent-sdk/overview)-backed agent can then answer questions against this knowledge base using a two-step retrieval strategy: text search first, with optional image lookup for visual context grounding if the text-base information is insufficient or ambiguous.

## Requirements

- [Bun](https://bun.sh) v1.0 or later
- A Google AI API key (for embeddings via `gemini-embedding-2-preview`)
- An Anthropic API key (for the agent)

## Setup

Install the necessary dependencies:

```bash
bun install
```

Set the required environment variables:

```bash
export GOOGLE_API_KEY="..."
export ANTHROPIC_API_KEY="..."
```

## Usage

### Process a document

Parse, chunk, embed, and store a document into the local knowledge base:

```bash
bun run process <file>
```

Options:

| Flag                          | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `-s, --screenshot-dir <path>` | Directory to save page screenshots. Defaults to `screenshots/`. |
| `-w, --overwrite`             | Overwrite existing screenshots. Defaults to `false`.            |

Example (using [this sample file](./data/Medication_Side_Effect_Flyer.pdf)):

```bash
bun run process ./data/Medication_Side_Effect_Flyer.pdf
```

### Search

Run a vector similarity search against the knowledge base:

```bash
bun run search "<query>"
```

Options:

| Flag                   | Description                          |
| ---------------------- | ------------------------------------ |
| `-l, --limit <number>` | Maximum number of results to return. |

Example:

```bash
bun run search "contraindications for ibuprofen" --limit 5
```

### Agent

Use a Claude-backed agent with extended thinking to answer questions against the knowledge base. The agent follows a two-step retrieval process: it runs a text search first and, if needed, retrieves full-page screenshots for visual content such as charts or tables.

```bash
bun run agent "<query>"
```

Options:

| Flag                        | Description                      |
| --------------------------- | -------------------------------- |
| `-r, --resume <session-id>` | Resume a previous agent session. |

Example:

```bash
bun run agent "What would i take Esomeprazole for and what could its side effects be?"
```

To resume a session:

```bash
bun run agent "Follow-up question" --resume <session-id>
```

### Evaluation

Run the evaluation suite. Each question is sent to the agent, and the response is scored against expected answers. Tool usage (search and image calls) is tracked per question.

```bash
bun run eval
```

Options:

| Flag                    | Description                    |
| ----------------------- | ------------------------------ |
| `--category <category>` | Filter questions by category.  |
| `--output <path>`       | Save results to a JSON file.   |
| `--quiet`               | Suppress per-question output.  |

Example:

```bash
bun run eval --output results.json
bun run eval --category aggregation_counting
```

The eval suite uses 20 questions from `src/eval/gold.json` across 7 categories (`direct_lookup`, `synonym_paraphrase`, `brand_generic_resolution`, `cross_category_reasoning`, `negation_absence`, `aggregation_counting`, `disambiguation`). Answers are scored with type-specific strategies: set F1 (with alias resolution), exact match, boolean, numeric, and free-text via Claude Sonnet as LLM judge. Per-question output includes tool call counts and flags questions where the agent used the image fallback tool (`[img]`).

## How it works

1. **Processing** — `@llamaindex/liteparse` parses the document and produces per-page text and screenshots. Text is chunked with `@chonkiejs/core` using a recursive strategy (max 4096 characters per chunk). Each chunk is embedded via the Gemini embedding API (3072 dimensions) and stored in a local LanceDB table with an HNSW-SQ index.

2. **Search** — A query is embedded with the same model and a vector similarity search is run against the LanceDB table, returning the closest matching text chunks and their associated screenshot paths.

3. **Agent** — A Claude agent is initialized with a retrieval MCP server that exposes two tools: `search` (vector search) and `get_image` (reads a screenshot by path and returns it as a base64 image). The agent uses extended thinking and is instructed to rely only on retrieved content rather than prior knowledge.

## Development

```sh
bun run lint # run eslint, use lint:fix to fix errors
bun run format # run prettier, use format:fix to fix errors
```

## License

[MIT](./LICENSE)
