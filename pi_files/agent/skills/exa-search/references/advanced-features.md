---
name: exa-search-advanced
description: Advanced Exa Search API features — entity search (company/person), streaming answers, deep-reasoning search, text verbosity & section control, contents error handling, research task inferSchema, pro model, cost breakdowns, pagination, and content moderation.
---

# Advanced Features

## Entity Search (Company/Person)

When searching with `category: "company"` or `category: "people"`, results include structured entity data.

### Company Search

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "AI search startup",
    "numResults": 3,
    "category": "company",
    "text": true
  }'
```

Response entity includes:
- `properties.name` — Company name
- `properties.foundedYear` — Year founded
- `properties.description` — Company description
- `properties.workforce.total` — Employee count
- `properties.headquarters` — Address, city, country
- `properties.financials.revenueAnnual` — Annual revenue (USD)
- `properties.financials.fundingTotal` — Total funding (USD)
- `properties.financials.fundingLatestRound` — Most recent funding round (name, date, amount)
- `properties.webTraffic.visitsMonthly` — Estimated monthly visits

### People Search

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "AI researcher transformer architecture",
    "numResults": 3,
    "category": "people",
    "text": true
  }'
```

Response entity includes:
- `properties.name` — Person's full name
- `properties.location` — Location
- `properties.workHistory[]` — Array of work entries:
  - `title` — Job title
  - `location` — Work location
  - `dates.from` / `dates.to` — Employment period (YYYY-MM-DD)
  - `company.name` / `company.id` — Company reference

---

## Streaming Answers

The `/answer` endpoint supports server-sent events (SSE) for real-time streaming.

```bash
curl -s -N -X POST 'https://api.exa.ai/answer' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Explain how transformers work",
    "stream": true
  }'
```

Each SSE event contains either:
- `answer` — Partial answer chunk (string)
- `citations` — Final array of citation objects (id, url, title)

---

## Deep Reasoning Search

The `"deep-reasoning"` search type uses a reasoning model for advanced synthesis:

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Compare and contrast the approaches of SpaceX and Blue Origin for space launch",
    "type": "deep-reasoning",
    "numResults": 10,
    "text": true
  }'
```

Returns the same output structure as deep search (`output.content` + `output.grounding`).

---

## Text Verbosity & Section Control

When requesting `contents.text` as an object, you can control what content is returned.

### Verbosity Levels

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your query",
    "numResults": 3,
    "contents": {
      "text": {
        "verbosity": "full",
        "includeHtmlTags": false
      }
    }
  }'
```

| Verbosity | Description |
|-----------|-------------|
| `compact` | Most concise, main content only (default) |
| `standard` | Balanced content with more detail |
| `full` | Complete content including all sections |

> **Note**: `verbosity`, `includeSections`, and `excludeSections` require `livecrawl: "always"` (or `maxAgeHours: 0`) to take effect.

### Section Filtering

Include or exclude specific semantic sections of a page:

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your query",
    "numResults": 3,
    "contents": {
      "text": {
        "includeSections": ["body", "header"],
        "excludeSections": ["navigation", "footer", "sidebar"]
      }
    },
    "maxAgeHours": 0
  }'
```

Available sections: `header`, `navigation`, `banner`, `body`, `sidebar`, `footer`, `metadata`

---

## Contents Error Handling

The `/contents` endpoint returns a `statuses` array alongside results:

```json
{
  "statuses": [
    {
      "id": "https://example.com/broken",
      "status": "error",
      "error": {
        "tag": "CRAWL_NOT_FOUND",
        "httpStatusCode": 404
      }
    },
    {
      "id": "https://example.com/valid",
      "status": "success"
    }
  ]
}
```

### Error Tags

| Tag | Meaning |
|-----|---------|
| `CRAWL_NOT_FOUND` | URL returned 404 |
| `CRAWL_TIMEOUT` | Page took too long to load |
| `CRAWL_LIVECRAWL_TIMEOUT` | Livecrawl attempt timed out |
| `SOURCE_NOT_AVAILABLE` | Content source unavailable |
| `UNSUPPORTED_URL` | URL format not supported |
| `CRAWL_UNKNOWN_ERROR` | Unspecified crawl failure |

Check `statuses` per-URL to gracefully handle partial failures.

---

## Research Task — Infer Schema

When you don't know the output schema in advance, set `inferSchema: true`:

```bash
curl -s -X POST 'https://api.exa.ai/research/v0/tasks' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "instructions": "Find and compare the pricing of the top 5 cloud GPU providers",
    "model": "exa-research",
    "output": {
      "inferSchema": true
    }
  }'
```

An LLM will generate the schema automatically based on the instructions.

---

## Research Task — Pro Model

Use `"model": "exa-research-pro"` for more capable research:

```bash
curl -s -X POST 'https://api.exa.ai/research/v0/tasks' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "instructions": "Write a comprehensive market analysis of the AI chip industry",
    "model": "exa-research-pro",
    "output": {
      "schema": {
        "type": "object",
        "properties": {
          "marketOverview": { "type": "string" },
          "keyPlayers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "marketShare": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }'
```

---

## Research Task — Pagination

List tasks with cursor-based pagination:

```bash
# First page (default limit: 25)
curl -s "https://api.exa.ai/research/v0/tasks" \
  -H "x-api-key: $EXA_API_KEY"

# Next page
curl -s "https://api.exa.ai/research/v0/tasks?cursor=<nextCursor>&limit=50" \
  -H "x-api-key: $EXA_API_KEY"
```

Response includes `hasMore` (boolean) and `nextCursor` (string or null).

---

## Content Moderation

Enable moderation to filter unsafe content:

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "your query",
    "numResults": 5,
    "moderation": true,
    "text": true
  }'
```

---

## Cost Breakdowns

The response `costDollars` object contains multi-level breakdown:

```json
{
  "costDollars": {
    "total": 0.012,
    "search": {
      "neural": 0.007,
      "deep": 0.015
    },
    "contents": {
      "text": 0.001,
      "highlight": 0.001,
      "summary": 0.001
    },
    "perRequestPrices": {
      "neuralSearch_1_25_results": 0.005,
      "neuralSearch_26_100_results": 0.025,
      "deepSearch_1_25_results": 0.015,
      "deepSearch_26_100_results": 0.075
    },
    "perPagePrices": {
      "contentText": 0.001,
      "contentHighlight": 0.001,
      "contentSummary": 0.001
    }
  }
}
```

---

## Full OpenAPI Spec

For the complete schema (all fields, types, and enums), see the [Exa OpenAPI spec](https://raw.githubusercontent.com/exa-labs/openapi-spec/refs/heads/master/exa-openapi-spec.yaml).
