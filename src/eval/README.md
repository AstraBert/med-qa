# Medication Side Effects Eval Suite

An evaluation suite for testing how well an agent can answer questions over a structured medication side-effects PDF. The PDF is organized as a table with columns for reason-for-use, generic names, brand names, and side effects — but the content within each cell is semi-structured (sub-headers, comma-separated lists, images, etc.).

## Why this is non-trivial

- **Synonym resolution**: The PDF says "Queasiness or Throwing Up", not "nausea" or "vomiting." An agent must map user language to the document's terms.
- **Column disambiguation**: The same term (e.g., "Queasiness") can appear as both a *reason for medicine* and a *side effect*. The agent must reason about which column it's reading.
- **Category-level side effects**: Side effects are listed per category, not per drug. An agent shouldn't fabricate per-drug distinctions.
- **Brand/generic mapping**: Some drugs have brand names in the PDF, others don't. The agent must not hallucinate brand names from general knowledge.
- **Structural nuance**: Sub-headers (ACE Inhibitors, ARBs, Diuretics) and similarly-named categories ("Lowers Blood Pressure" vs. "Lowers Blood Pressure and Heart Rate") require precise parsing.
- **Aggregation and counting**: Questions requiring counts, deduplication, or comparisons across multiple categories expose limitations of naive vector search — a structured query tool (SQL) would handle these trivially.

## Questions (20 total)

| ID     | Category                  | Type        | Question                                                                              |
|--------|---------------------------|-------------|---------------------------------------------------------------------------------------|
| DL-02  | direct_lookup             | free_text   | What category does Warfarin fall under?                                               |
| DL-03  | direct_lookup             | free_text   | What type of blood pressure medication is Diltiazem classified as in the chart?        |
| SYN-01 | synonym_paraphrase        | set         | What medications can I take for nausea?                                               |
| SYN-02 | synonym_paraphrase        | set         | Which drugs for high blood pressure can cause a cough?                                |
| SYN-03 | synonym_paraphrase        | boolean     | Can vomiting be a side effect of cholesterol medication?                              |
| SYN-04 | synonym_paraphrase        | set         | What are the side effects of medications used to treat acid reflux?                   |
| BG-01  | brand_generic_resolution  | free_text   | What is Xanax used for?                                                              |
| BG-02  | brand_generic_resolution  | boolean     | Does Tylenol have the same side effects as Motrin?                                    |
| BG-03  | brand_generic_resolution  | free_text   | What's the brand name for Morphine?                                                   |
| XC-01  | cross_category_reasoning  | free_text   | Which medication category in the chart has the most side effects listed?               |
| XC-02  | cross_category_reasoning  | set         | A patient takes both Lisinopril and Tramadol. Which side effects are listed for both of these medications? |
| XC-03  | cross_category_reasoning  | set         | Do blood thinners and cholesterol medications share any side effects?                 |
| NA-01  | negation_absence          | boolean     | My patient is on Losartan for blood pressure. Should I warn them about headache as a possible side effect based on this chart? |
| NA-02  | negation_absence          | boolean     | Is dizziness listed as a side effect of any antibiotic in the chart?                  |
| NA-03  | negation_absence          | boolean     | Is constipation listed as a side effect of any cholesterol medication?                |
| AG-01  | aggregation_counting      | number      | How many total unique side effects are listed across the entire chart?                 |
| AG-02  | aggregation_counting      | number      | My patient takes Metoprolol, Lisinopril, Atorvastatin, Warfarin, and Omeprazole. How many unique side effects should I monitor for across all five medications? |
| AG-03  | aggregation_counting      | number      | How many medication categories in the chart list 'Upset stomach' as a side effect?    |
| DIS-01 | disambiguation            | free_text   | Is 'Queasiness' a reason for taking medication, a side effect, or both?               |
| DIS-02 | disambiguation            | set         | The chart lists 'Throwing up' under both 'Reason for Medicine' and 'Side Effects.' Which specific medications are listed to treat throwing up? |

### Category breakdown

| Category                 | Count | What it tests                                                    |
|--------------------------|-------|------------------------------------------------------------------|
| direct_lookup            | 2     | Retrieve facts using exact terms; parse sub-headers within categories |
| synonym_paraphrase       | 4     | Map user language ("nausea", "acid reflux") to PDF terminology   |
| brand_generic_resolution | 3     | Resolve brand/generic names; handle missing brand names          |
| cross_category_reasoning | 3     | Compare side effects across multiple categories (set operations, argmax) |
| negation_absence         | 3     | Confirm something is *not* in the data; disambiguate near-duplicate categories |
| aggregation_counting     | 3     | Count or aggregate across the entire table; deduplicate unions   |
| disambiguation           | 2     | Distinguish same term appearing in different columns/roles       |

## Answer types

- **set** — Order-insensitive list. Scored with precision/recall/F1. Supports alias resolution (e.g., brand names accepted for generics).
- **boolean** — True/false. Scored 1.0 or 0.0.
- **number** — Integer or float. Scored 1.0 if within tolerance, else 0.0.
- **free_text** — Open-ended. Scored by LLM-as-judge (Claude Sonnet) against a rubric.

## Running the eval

```bash
# Run the full eval suite
bun run eval

# Filter by category
bun run eval --category aggregation_counting

# Save results to JSON
bun run eval --output results.json
```

Per-question output includes the score, tool call counts (search and image), and an `[img]` flag when the agent used the image fallback tool. A tool usage summary is printed at the end showing aggregate search vs. image call distribution.
