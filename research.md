# mails - Research

## 产品定位

面向 AI Agent 的邮件收发基础设施（mails.dev）。

- **开源 CLI** — `npx mails`，本地配置域名/keys，发送/接收邮件
- **云服务** — Agent 通过 x402 付费使用，无需注册
- **数据存储** — 多 provider（db9.ai 优先，本地 SQLite 默认）

## 现有代码资产

### 1. cloud.sandbank.dev/services/mailbox（收邮件 - 最简实现）

- `src/index.ts` — 完整的 Email Worker + HTTP API，单文件
- `email()` handler：接收邮件 → 解析 MIME → 提取验证码 → 存 D1
- `GET /api/code?to=&timeout=` — Long-poll 查询验证码（2s 轮询，max 55s）
- `GET /api/inbox?to=&limit=` — 收件箱列表
- D1 schema：`emails(id, to_address, from_address, subject, body, code, received_at)`

### 2. kimeeru/packages/email-worker（收邮件 - 完整实现）

- 多层垃圾邮件检测（正则 + TLD + AI）
- 完整 MIME 解析（multipart, base64, quoted-printable）
- Queue 异步处理
- 依赖：D1, KV, Queue, Workers AI

### 3. kimeeru 发邮件实现

- `apps/api/src/lib/email.ts` — Resend API 发邮件
- 支持 HTML + Text 双格式
- Magic link 邮件模板（多语言）

### 4. mails npm 包现状

- v0.2.0，2015-07-22 最后发布，完全过时
- 维护者：turing，关联包：mails-cli, mails-default, mails-flat
- 需要完全重写，保留包名和 npm scope

## 技术调研

### db9.ai 数据库

db9.ai 是面向 Agent 的 Serverless PostgreSQL 平台。

**核心特性：**
- 标准 PostgreSQL + pgvector + JSONB + fs9 文件系统 + pg_cron
- REST API：`POST /customer/databases/{id}/sql {"query":"..."}`
- 认证：Bearer token
- PG 直连：`pg.db9.io:5433`
- SQL 结果：`{ columns: string[], rows: unknown[][], row_count: number }`

**mails 邮件 schema（兼容 db9 的 PostgreSQL 格式）：**
```sql
CREATE TABLE emails (
  id serial PRIMARY KEY,
  mailbox text NOT NULL,          -- 收件地址 (e.g. agent@example.com)
  from_address text NOT NULL,
  from_name text DEFAULT '',
  to_address text NOT NULL,
  subject text DEFAULT '',
  body_text text DEFAULT '',
  body_html text DEFAULT '',
  code text,                       -- 自动提取的验证码
  headers jsonb DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text DEFAULT 'received' CHECK (status IN ('received', 'sent', 'failed', 'queued')),
  received_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_emails_mailbox ON emails(mailbox, received_at DESC);
CREATE INDEX idx_emails_direction ON emails(direction);
CREATE INDEX idx_emails_code ON emails(mailbox) WHERE code IS NOT NULL;
```

**本地 SQLite 版用相同 schema**（去掉 pgvector/timestamptz 换 TEXT）。

### x402 云服务支付

基于 HTTP 402 协议，Agent 用 USDC 按需付费。

**依赖：**
- `@x402/hono` — Hono 框架中间件
- `@x402/core` — 核心类型和 facilitator client
- `@x402/evm` — EVM 链上验证
- `@coinbase/x402` — Coinbase CDP 认证

**流程：**
1. Agent 发请求（无支付头）→ 402 + PaymentRequired（含价格、钱包、网络）
2. Agent 签署 USDC 支付 → 重发请求 + X-PAYMENT 头
3. 服务端验证 + settle → 执行操作 → 返回结果

**环境变量：**
- `X402_WALLET` — 收款钱包地址
- `X402_NETWORK` — `eip155:8453`（Base Mainnet）
- `X402_PRICE_CENTS` — 每次操作价格（美分）
- `COINBASE_API_KEY_ID` / `COINBASE_API_KEY_SECRET`

**实现模式（参考 cloud.sandbank.dev）：**
- API Key 优先 → 开发模式 → x402 支付 → 拒绝
- x402 仅对 POST 生效
- 异步初始化 + 降级保护

## 决策记录

| 问题 | 决策 |
|------|------|
| 邮件数据存储 | 多 provider：db9.ai（首选）、本地 SQLite（默认） |
| Agent 认证 | x402 USDC 支付（云服务）；API Key（自托管） |
| 开源/闭源 | CLI 开源，云服务闭源 |
| 域名 | mails.dev |
| 收邮件 | Cloudflare Email Routing Worker，基于 sandbank mailbox 简洁模式 |
| 发邮件 | Provider 抽象，先 Resend |
| 打包 | Bun 编译 CLI |
