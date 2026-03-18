# mails — Email for AI Agents

Send and receive emails programmatically. Supports custom domains (self-hosted) or zero-config `@mails.dev` addresses (hosted).

## Quick Start (Hosted — recommended for agents)

```bash
# Install
npm install -g mails    # or: bunx mails

# Claim a @mails.dev mailbox (opens browser for human to approve)
mails claim myagent
# → myagent@mails.dev claimed, API key saved to ~/.mails/config.json

# Send
mails send --to user@example.com --subject "Hello" --body "World"

# Check inbox
mails inbox

# Wait for verification code
mails code --to myagent@mails.dev --timeout 30
```

## Claiming a @mails.dev Mailbox

Each human user can create up to 10 free mailboxes for their agents.

### With browser (local machine)

```bash
mails claim myagent
# Opens browser → human logs in via Clerk → confirms claim
# CLI receives API key automatically via polling
```

### Without browser (sandbox / SSH / headless)

```bash
mails claim myagent
# Output:
#   Claiming myagent@mails.dev
#
#   To complete, ask a human to visit:
#
#     https://mails.dev/claim
#
#   and enter this code:
#
#     KDNR-CHPC
#
#   Waiting...
```

The agent should relay the URL and code to its human user (e.g. via chat). Once the human confirms, the CLI receives the API key.

### Claim API (for programmatic use)

```bash
# 1. Start a claim session (no auth needed)
curl -X POST https://api.mails.dev/v1/claim/start \
  -H "Content-Type: application/json" \
  -d '{"name": "myagent"}'
# → {"session_id": "xxx", "device_code": "ABCD-1234", "expires_in": 600}

# 2. Poll for result
curl "https://api.mails.dev/v1/claim/poll?session=xxx"
# → {"status": "pending"} or {"status": "complete", "mailbox": "myagent@mails.dev", "api_key": "mk_xxx"}

# 3. Human confirms at https://mails.dev/claim (enters device code or uses direct link)
```

## Configuration

Config lives at `~/.mails/config.json`. After `mails claim`, the key fields are set automatically:

```json
{
  "mailbox": "myagent@mails.dev",
  "api_key": "mk_xxx"
}
```

Set additional values via CLI:

```bash
mails config set <key> <value>
mails config get <key>
mails config          # show all
```

| Key | Description |
|-----|-------------|
| `mailbox` | Your receiving address (set by `mails claim`) |
| `api_key` | API key for inbox/code queries (set by `mails claim`) |
| `resend_api_key` | Resend API key for sending (get one at resend.com) |
| `default_from` | Default sender, e.g. `"Agent <agent@yourdomain.com>"` |
| `storage_provider` | `sqlite` (local, default) or `db9` (db9.ai cloud) |

## Sending Emails

### CLI

```bash
# Plain text
mails send --to user@example.com --subject "Report" --body "Here is your report."

# HTML
mails send --to user@example.com --subject "Report" --html "<h1>Report</h1><p>Details...</p>"

# Custom sender
mails send --from "Bot <bot@mydomain.com>" --to user@example.com --subject "Hi" --body "Hello"
```

### Programmatic (SDK)

```typescript
import { send } from 'mails'

const result = await send({
  to: 'user@example.com',
  subject: 'Hello from agent',
  text: 'This is a test email.',
})
console.log(result.id) // Resend message ID
```

## Receiving Emails

After claiming a mailbox, query via CLI or API key:

### CLI

```bash
# List inbox
mails inbox
mails inbox --mailbox myagent@mails.dev

# Wait for verification code (long-poll)
mails code --to myagent@mails.dev --timeout 30
# Prints code to stdout for piping: CODE=$(mails code --to myagent@mails.dev)
```

### SDK

```typescript
import { getInbox, waitForCode } from 'mails'

const emails = await getInbox('myagent@mails.dev', { limit: 10 })

const result = await waitForCode('myagent@mails.dev', { timeout: 30 })
if (result) {
  console.log(result.code) // "123456"
}
```

### API (with API key)

```bash
# List inbox
curl -H "Authorization: Bearer mk_YOUR_API_KEY" \
  "https://api.mails.dev/v1/inbox"

# Wait for verification code (long-poll up to 55s)
curl -H "Authorization: Bearer mk_YOUR_API_KEY" \
  "https://api.mails.dev/v1/code?timeout=30"

# Get email detail
curl -H "Authorization: Bearer mk_YOUR_API_KEY" \
  "https://api.mails.dev/v1/email?id=EMAIL_ID"
```

## Self-Hosted Setup

For custom domains instead of @mails.dev:

```bash
mails setup
```

This opens a browser-based wizard at `mails.dev/setup` that guides you through:
1. Cloudflare API token configuration
2. DNS record setup (MX, SPF, DKIM, DMARC)
3. Email Worker deployment
4. Send provider (Resend) configuration
5. Storage provider selection

## Storage Providers

### SQLite (default)
Local database at `~/.mails/mails.db`. Zero config.

### db9.ai
Cloud PostgreSQL for agents. Enables multi-agent access to shared mailboxes.

```bash
mails config set storage_provider db9
mails config set db9_token YOUR_TOKEN
mails config set db9_database_id YOUR_DB_ID
```

## Links

- Website: https://mails.dev
- npm: https://www.npmjs.com/package/mails
- GitHub: https://github.com/chekusu/mails
