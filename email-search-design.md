# Email Search Design

Status: approved for implementation after review

## Scope

This document defines the first built-in email search feature for the `mails` repository.

The goal is to add mailbox-scoped search to the CLI and SDK without changing the current send/receive model.

This document covers:

- public API shape
- CLI command shape
- DB9-backed implementation strategy
- SQLite fallback strategy
- test plan and pseudocode

This document does not cover:

- semantic search
- embeddings
- vector indexes
- re-ranking or LLM-based retrieval

## Why Not Vector Search

DB9 supports vector search, but that is not the right primitive for this feature.

Mailbox search needs:

- exact mailbox scoping
- predictable keyword matching
- support for addresses, codes, and quoted phrases
- transparent ranking rules

Vector search would only make sense later if we explicitly store embeddings for email content first.

For v1, search is:

- structured SQL filtering for exact fields
- PostgreSQL full-text search for free-text content on DB9
- case-insensitive fallback matching on SQLite

## DB9 Capabilities Used

This design is based on DB9 public docs and `skill.md`.

Relevant capabilities explicitly documented by DB9:

- full PostgreSQL
- full-text search
- `tsvector` / `tsquery`
- `websearch_to_tsquery`
- ranking with `ts_rank`
- highlighting
- GIN indexing
- JSONB

References:

- `https://db9.ai/`
- `https://db9.ai/skill.md`

## User-Facing Behavior

The feature will be exposed through the existing inbox command instead of a new top-level command.

Examples:

```bash
mails inbox --query "reset password"
mails inbox --query "noreply@github.com"
mails inbox --query "123456"
mails inbox --mailbox agent@example.com --query "invoice" --limit 10
mails inbox --query "\"build failed\" OR deploy" --direction inbound
```

Behavior rules:

- search is always scoped to one mailbox
- `--query` switches `mails inbox` from list mode to search mode
- `--direction` still works in search mode
- `--limit` still works in search mode
- if `--query` is absent, current inbox behavior stays unchanged

## API Design

### Core Types

```ts
export interface EmailQueryOptions {
  limit?: number
  offset?: number
  direction?: 'inbound' | 'outbound'
}

export interface EmailSearchOptions extends EmailQueryOptions {
  query: string
}
```

### Storage Provider Contract

```ts
export interface StorageProvider {
  name: string
  init(): Promise<void>
  saveEmail(email: Email): Promise<void>
  getEmails(mailbox: string, options?: EmailQueryOptions): Promise<Email[]>
  searchEmails(mailbox: string, options: EmailSearchOptions): Promise<Email[]>
  getEmail(id: string): Promise<Email | null>
  getCode(mailbox: string, options?: { timeout?: number; since?: string }): Promise<{ code: string; from: string; subject: string } | null>
}
```

### Core Receive API

```ts
export async function searchInbox(
  mailbox: string,
  options: EmailSearchOptions,
): Promise<Email[]>
```

### SDK Export

```ts
export { searchInbox } from './core/receive.js'
```

## CLI Design

The CLI stays under `mails inbox`.

### Syntax

```bash
mails inbox --query <text> [--mailbox <address>] [--direction inbound|outbound] [--limit <n>]
```

### Parsing Rules

- `mails inbox <id>` keeps meaning “show one email”
- `mails inbox --query ...` means search list mode
- `mails inbox` without `--query` means current list mode
- `--direction` is optional in both list mode and search mode

### Output

Search results use the current inbox list format.

No-result behavior:

```text
No emails found for query: <query>
```

## Search Semantics

The query string is a single user-entered search expression.

Fields searched in v1:

- `subject`
- `body_text`
- `body_html`
- `from_name`
- `from_address`
- `to_address`
- `code`

Structured filters in v1:

- `mailbox`
- `direction`
- `limit`
- `offset`

Sorting:

- DB9 search mode: relevance first, then `received_at DESC`
- SQLite fallback: `received_at DESC`

## DB9 Implementation

### High-Level Strategy

DB9 search should use a hybrid query:

1. hard filters for mailbox and direction
2. full-text search for human text
3. substring fallback for addresses and code-like tokens
4. relevance ranking for full-text matches

This avoids using vector search while still taking advantage of DB9 full-text support.

### Index Plan

Keep existing indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_code ON emails(mailbox) WHERE code IS NOT NULL;
```

Add a GIN full-text index:

```sql
CREATE INDEX IF NOT EXISTS idx_emails_search_fts
ON emails
USING GIN (
  setweight(to_tsvector('simple', coalesce(subject, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(from_name, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(body_text, '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(body_html, '')), 'D')
);
```

Reasoning:

- `subject` should rank highest
- `from_name` is useful but lower priority than subject
- `body_text` and `body_html` are useful but should not outrank subject matches
- email addresses and codes are better handled with explicit substring predicates

### Query Shape

The search query should be built with `websearch_to_tsquery('simple', ...)`.

This gives:

- quoted phrase support
- `or`
- `-term` exclusion
- more natural CLI search syntax

Planned SQL shape:

```sql
WITH ranked AS (
  SELECT
    *,
    ts_rank(
      setweight(to_tsvector('simple', coalesce(subject, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(from_name, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(body_text, '')), 'C') ||
      setweight(to_tsvector('simple', coalesce(body_html, '')), 'D'),
      websearch_to_tsquery('simple', $query)
    ) AS rank
  FROM emails
  WHERE mailbox = $mailbox
    AND ($direction IS NULL OR direction = $direction)
    AND (
      (
        setweight(to_tsvector('simple', coalesce(subject, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(from_name, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(body_text, '')), 'C') ||
        setweight(to_tsvector('simple', coalesce(body_html, '')), 'D')
      ) @@ websearch_to_tsquery('simple', $query)
      OR from_address ILIKE $pattern
      OR to_address ILIKE $pattern
      OR code ILIKE $pattern
    )
)
SELECT *
FROM ranked
ORDER BY rank DESC, received_at DESC
LIMIT $limit OFFSET $offset;
```

### Why Hybrid Instead Of Pure FTS

Pure FTS is not ideal for:

- email addresses
- short numeric codes
- punctuation-heavy tokens

So v1 intentionally combines:

- FTS for natural text
- `ILIKE` fallback for address/code lookup

## SQLite Implementation

SQLite is the local-development and test fallback.

SQLite v1 should not introduce FTS5 yet.

Instead it should use a deterministic case-insensitive `LIKE` search across the same fields:

```sql
WHERE mailbox = ?
  AND (?direction IS NULL OR direction = ?)
  AND (
    subject LIKE ? COLLATE NOCASE
    OR body_text LIKE ? COLLATE NOCASE
    OR body_html LIKE ? COLLATE NOCASE
    OR from_address LIKE ? COLLATE NOCASE
    OR from_name LIKE ? COLLATE NOCASE
    OR to_address LIKE ? COLLATE NOCASE
    OR code LIKE ? COLLATE NOCASE
  )
ORDER BY received_at DESC
LIMIT ? OFFSET ?
```

Reasoning:

- simpler migration story
- easy local testing
- behavior stays understandable
- avoids maintaining two different local schemas for now

## Migration Impact

DB9 schema needs one new index for search.

SQLite schema does not need a migration in v1.

No existing user-facing command is removed or renamed.

## Testing Plan

### 1. SQLite Provider Unit Tests

Goals:

- verify case-insensitive search
- verify subject/body/from/code matching
- verify mailbox scoping
- verify direction filtering
- verify sort order and limit behavior

Pseudocode:

```ts
test('searchEmails matches subject/body/from/code in sqlite', async () => {
  const provider = createSqliteProvider(TEST_DB)
  await provider.init()

  await provider.saveEmail(email({ id: 'a', subject: 'Reset password', from_name: 'Security Team', body_text: 'Use code 654321' }))
  await provider.saveEmail(email({ id: 'b', subject: 'Weekly digest', from_address: 'digest@example.com' }))

  expect(await provider.searchEmails('agent@test.com', { query: 'security' })).toEqual([emailA])
  expect(await provider.searchEmails('agent@test.com', { query: '654321' })).toEqual([emailA])
  expect(await provider.searchEmails('agent@test.com', { query: 'digest@example.com' })).toEqual([emailB])
})
```

### 2. DB9 Provider Unit Tests

Goals:

- verify generated SQL uses DB9 full-text search primitives
- verify generated SQL still includes substring fallback
- verify single quotes are escaped
- verify direction filter is included

Pseudocode:

```ts
test('searchEmails builds DB9 FTS query', async () => {
  mockFetchCaptureQuery()

  await provider.searchEmails('agent@test.com', {
    query: '"reset password" OR 654321',
    direction: 'inbound',
    limit: 5,
  })

  expect(sql).toContain("websearch_to_tsquery('simple'")
  expect(sql).toContain("to_tsvector('simple'")
  expect(sql).toContain("from_address ILIKE")
  expect(sql).toContain("code ILIKE")
  expect(sql).toContain("direction = 'inbound'")
})
```

### 3. Core Receive Tests

Goals:

- verify `searchInbox()` delegates to `getStorage().searchEmails()`

Pseudocode:

```ts
test('searchInbox delegates to storage.searchEmails', async () => {
  mock.module('../../src/core/storage.js', () => ({
    getStorage: async () => ({ searchEmails: async () => [emailA] }),
  }))

  const { searchInbox } = await importFresh('../../src/core/receive.ts')
  expect(await searchInbox('agent@test.com', { query: 'reset' })).toEqual([emailA])
})
```

### 4. CLI Inbox Command Tests

Goals:

- verify `--query` routes to search mode
- verify no-query path still routes to list mode
- verify no-result message changes in search mode
- verify `--direction` is passed through

Pseudocode:

```ts
test('inboxCommand uses searchInbox when --query is present', async () => {
  mock.module('../../src/core/receive.js', () => ({
    getInbox: async () => [],
    searchInbox: async () => [emailA],
    getEmail: async () => null,
  }))

  await inboxCommand(['--mailbox', 'agent@test.com', '--query', 'reset', '--direction', 'inbound'])

  expect(searchInboxSpy).toHaveBeenCalledWith('agent@test.com', {
    query: 'reset',
    direction: 'inbound',
    limit: 20,
  })
})
```

### 5. SDK Export Tests

Goals:

- verify top-level `src/index.ts` exports `searchInbox`

Pseudocode:

```ts
test('index exports searchInbox', async () => {
  const mod = await import('../../src/index.ts')
  expect(typeof mod.searchInbox).toBe('function')
})
```

### 6. Coverage Work Needed Alongside Search

The current repository reports `100%` only for the subset of files loaded by the existing coverage command.

Search work should be paired with tests that pull these files into real coverage:

- `src/cli/index.ts`
- `src/cli/commands/send.ts`
- `src/cli/commands/config.ts`
- `src/cli/commands/code.ts`
- `src/cli/commands/inbox.ts`
- `src/cli/commands/claim.ts`
- `src/core/receive.ts`
- `src/core/storage.ts`
- `src/index.ts`

Existing note:

- `test/e2e/claim-flow.test.ts` already exists and should be considered in future coverage strategy
- it is not currently included by `package.json` `test` or `test:coverage`

## Implementation Order

1. finalize provider contract in `src/core/types.ts`
2. add `searchInbox()` to `src/core/receive.ts`
3. export `searchInbox()` from `src/index.ts`
4. implement SQLite fallback search
5. implement DB9 hybrid full-text search
6. update `mails inbox` CLI parsing and help text
7. add unit tests for provider/core/CLI/export paths
8. decide whether to extend coverage script after command-level tests exist

## Explicit Non-Goals For V1

- embeddings
- pgvector usage
- semantic similarity search
- fuzzy ranking with LLMs
- cross-mailbox global search
- server-side saved search presets

## Future Extension Path

If semantic mail retrieval is ever needed later, it should be a separate feature with its own design:

1. define embedding model and dimensionality
2. store embeddings per email or per chunk
3. backfill historical emails
4. add vector indexes
5. add a separate semantic-search API instead of overloading keyword search
