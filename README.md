# med-qa

An open source, local agent QA workflow for ingesting, searching, and querying a medical factsheet using vector embeddings.

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

| Flag                      | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `-c, --chunk-limit <number>` | Number of chunks to return. Defaults to `1`.      |

Example:

```bash
bun run search "contraindications for ibuprofen" --chunk-limit 5
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

Run the [evaluation suite](https://github.com/run-llama/llamaindex-lancedb-medqa/tree/main/src/eval). Each question is sent to the agent, and the response is scored against expected answers. Tool usage (search and image calls) is tracked per question.

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

## Representative results

The agent QA results below are from the [evaluation suite](./src/eval/README.md), built using the Claude Agent SDK
and the Sonnet 4.6 model. Depending on the model and harness you use, results may vary.

We designed a 20-question eval suite spanning seven categories. Each question targets a specific failure mode — synonym resolution, column disambiguation, cross-category reasoning, and so on. Answer types include set matching (scored by F1), boolean (exact match), numeric (exact match), and free text (LLM-as-judge with a rubric).

### Results by Category

| Category                 | Score  | Questions |
|--------------------------|--------|-----------|
| cross_category_reasoning | 100.0% | 3         |
| direct_lookup            | 100.0% | 2         |
| disambiguation           | 100.0% | 2         |
| negation_absence         | 100.0% | 3         |
| synonym_paraphrase       |  97.0% | 4         |
| brand_generic_resolution |  66.7% | 3         |
| aggregation_counting     |  33.3% | 3         |
| **Overall**              | **84.4%** | **20** |

### Per-Question Results

| ID     | Category                 | Score  | Search Calls | Image Calls |
|--------|--------------------------|--------|--------------|-------------|
| DL-02  | direct_lookup            | 100.0% | 4            | 1           |
| DL-03  | direct_lookup            | 100.0% | 5            | 1           |
| SYN-01 | synonym_paraphrase       | 100.0% | 1            | 0           |
| SYN-02 | synonym_paraphrase       |  88.0% | 1            | 0           |
| SYN-03 | synonym_paraphrase       | 100.0% | 1            | 0           |
| SYN-04 | synonym_paraphrase       | 100.0% | 1            | 0           |
| BG-01  | brand_generic_resolution |   0.0% | 2            | 1           |
| BG-02  | brand_generic_resolution | 100.0% | 3            | 1           |
| BG-03  | brand_generic_resolution | 100.0% | 1            | 0           |
| XC-01  | cross_category_reasoning | 100.0% | 1            | 1           |
| XC-02  | cross_category_reasoning | 100.0% | 7            | 2           |
| XC-03  | cross_category_reasoning | 100.0% | 2            | 0           |
| NA-01  | negation_absence         | 100.0% | 2            | 1           |
| NA-02  | negation_absence         | 100.0% | 3            | 1           |
| NA-03  | negation_absence         | 100.0% | 1            | 0           |
| AG-01  | aggregation_counting     |   0.0% | 7            | 1           |
| AG-02  | aggregation_counting     | 100.0% | 8            | 1           |
| AG-03  | aggregation_counting     |   0.0% | 2            | 1           |
| DIS-01 | disambiguation           | 100.0% | 1            | 0           |
| DIS-02 | disambiguation           | 100.0% | 1            | 0           |

## Development

```sh
bun run lint # run eslint, use lint:fix to fix errors
bun run format # run prettier, use format:fix to fix errors
```
