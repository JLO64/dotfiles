---
name: exa-search
description: Search the web, retrieve page contents, find similar pages, and generate answers with citations using the Exa Search API (embeddings-based neural search, deep search, and traditional keyword search). Use for general web research, content extraction, Q&A, and finding related content.
---

# Exa Search

## Setup

The Exa API key must be available in the `EXA_API_KEY` environment variable.

```bash
# Verify it's set
echo "${EXA_API_KEY:?EXA_API_KEY is not set}"
```

The skill uses `curl` for all API calls. No additional dependencies are needed.

## API Base

All requests go to `https://api.exa.ai`. Authentication is via the `x-api-key` header.

## Endpoints

### 1. Search (`/search`)

Perform neural, deep, or auto search with optional content retrieval.

```bash
# Simple neural search — 3 results, no content
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your search query here",
    "numResults": 3,
    "type": "neural"
  }'

# Neural search with full page text
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your search query here",
    "numResults": 5,
    "text": true
  }'

# Deep search with query variations and synthesized output
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your search query here",
    "type": "deep",
    "additionalQueries": ["variant query 1", "variant query 2"],
    "numResults": 5,
    "text": true
  }'

# Search with domain filters and date range
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your search query here",
    "includeDomains": ["arxiv.org", "paperswithcode.com"],
    "startPublishedDate": "2025-01-01T00:00:00.000Z",
    "numResults": 5,
    "text": true
  }'

# Search with highlights and summaries
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your search query here",
    "numResults": 3,
    "contents": {
      "text": true,
      "highlights": {
        "query": "Key findings"
      },
      "summary": {
        "query": "Main developments"
      }
    }
  }'

# Auto search (Exa picks neural vs deep based on query)
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your search query here",
    "type": "auto",
    "numResults": 5,
    "text": true
  }'
```

### 2. Find Similar (`/findSimilar`)

Find pages similar to a given URL or text.

```bash
# Find similar by URL
curl -s -X POST 'https://api.exa.ai/findSimilar' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/page-to-find-similars-to",
    "numResults": 5,
    "text": true
  }'

# Find similar by text snippet
curl -s -X POST 'https://api.exa.ai/findSimilar' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Some text to find similar content for",
    "numResults": 5,
    "text": true
  }'
```

### 3. Get Contents (`/contents`)

Retrieve full content, highlights, or summaries for specific URLs.

```bash
# Simple text content from URLs
curl -s -X POST 'https://api.exa.ai/contents' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com/article"],
    "text": true
  }'

# Advanced: highlights, summary, subpages, extras
curl -s -X POST 'https://api.exa.ai/contents' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com/article"],
    "contents": {
      "text": {
        "maxCharacters": 2000
      },
      "highlights": {
        "query": "Key findings",
        "maxCharacters": 500
      },
      "summary": {
        "query": "Main points"
      },
      "extras": {
        "links": 3,
        "imageLinks": 1
      }
    }
  }'
```

### 4. Answer (`/answer`)

Generate a direct answer or detailed summary with citations.

```bash
# Simple answer
curl -s -X POST 'https://api.exa.ai/answer' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your question here",
    "text": true
  }'

# Structured answer with output schema
curl -s -X POST 'https://api.exa.ai/answer' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your question here",
    "text": true,
    "outputSchema": {
      "type": "object",
      "properties": {
        "answer": { "type": "string", "description": "The answer" },
        "keyFacts": { "type": "array", "items": { "type": "string" }, "description": "Key facts" }
      },
      "required": ["answer"]
    }
  }'
```

### 5. Research Tasks (`/research/v0/tasks`)

Create and manage long-running research tasks.

```bash
# Create a research task
curl -s -X POST 'https://api.exa.ai/research/v0/tasks' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "instructions": "What species of ant are similar to honeypot ants?",
    "model": "exa-research",
    "output": {
      "schema": {
        "type": "object",
        "properties": {
          "answer": { "type": "string" }
        }
      }
    }
  }'

# Check task status
curl -s "https://api.exa.ai/research/v0/tasks/{task_id}" \
  -H "x-api-key: $EXA_API_KEY"

# List tasks
curl -s "https://api.exa.ai/research/v0/tasks" \
  -H "x-api-key: $EXA_API_KEY"
```

## Search Types

| Type | Description |
|------|-------------|
| `neural` | Embeddings-based semantic search (default). Best for finding conceptually related content. |
| `auto` | Exa selects neural or deep based on the query. |
| `deep` | Query expansion + multi-query retrieval + LLM synthesis. Returns an `output` object with synthesized content and grounding/citations. |
| `deep-reasoning` | Deep search with reasoning model for advanced synthesis. |

## Key Parameters

| Parameter | Description |
|-----------|-------------|
| `numResults` | Number of results (1–100, default 10) |
| `includeDomains` / `excludeDomains` | Filter results by domain |
| `startPublishedDate` / `endPublishedDate` | Filter by published date (ISO 8601) |
| `startCrawlDate` / `endCrawlDate` | Filter by crawl/discovery date (ISO 8601) |
| `includeText` / `excludeText` | Require/exclude specific text in page content |
| `category` | Category filter (e.g., `"research paper"`, `"news"`, `"company"`, `"people"`) |
| `maxAgeHours` | Max age of cached content in hours. `0` = always livecrawl, `-1` = never livecrawl |
| `livecrawlTimeout` | Timeout for livecrawling in ms (default 10000) |

## Response Structure

All endpoints return JSON with:
- `requestId` — Unique request identifier
- `results` — Array of result objects (each with `title`, `url`, `publishedDate`, `author`, `score`, and optional `text`, `highlights`, `summary`, `subpages`, `extras`)
- `costDollars` — Cost breakdown for the request

Deep search variants also return:
- `output.content` — Synthesized output (string or structured object)
- `output.grounding` — Field-level citations with confidence scores

## See Also

- **Advanced features** — Entity search (company/person), streaming answers, deep-reasoning search, text verbosity & section control, contents error handling, research task inferSchema & pro model, cost breakdowns, and more. See [the advanced features guide](references/advanced-features.md).
- **Full OpenAPI spec** — Complete schema with all fields, types, and enums: [exa-openapi-spec.yaml](https://raw.githubusercontent.com/exa-labs/openapi-spec/refs/heads/master/exa-openapi-spec.yaml).
