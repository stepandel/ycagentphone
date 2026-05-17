# ycagentphone

Prototype phone Q&A agent for AgentPhone webhooks backed by an OpenAI knowledgebase.

## Architecture

```text
Caller
  -> AgentPhone phone number
  -> AgentPhone webhook
  -> Express service
  -> OpenAI Responses API with hosted file_search
  -> AgentPhone speaks the answer
```

Codex is useful as the builder and maintenance harness. The live call path is this service.

## Setup

```bash
cd ~/Development/ycagentphone
npm install
cp .env.example .env
```

Edit `.env` and set:

```bash
OPENAI_API_KEY=...
COMPANY_NAME=...
PUBLIC_CONTACT_EMAIL=...
```

Then seed the hosted knowledgebase:

```bash
npm run ingest:kb
```

Copy the printed `OPENAI_VECTOR_STORE_ID` into `.env`.

## Run Locally

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Local turn test through HTTP:

```bash
curl -X POST http://localhost:3000/test/turn \
  -H 'content-type: application/json' \
  -d '{"transcript":"What do you cost?"}'
```

Local turn test through the script:

```bash
npm run test:turn -- "What do you cost?"
```

## AgentPhone Webhook

Expose the local server with ngrok or another tunnel:

```bash
ngrok http 3000
```

Configure AgentPhone webhook mode to call:

```text
https://YOUR-TUNNEL/webhooks/agentphone
```

The webhook parser accepts several common payload shapes, including:

```json
{
  "callId": "call_123",
  "from": "+15551234567",
  "transcript": "What do you cost?"
}
```

and:

```json
{
  "call": { "id": "call_123", "from": "+15551234567" },
  "messages": [
    { "role": "caller", "content": "What do you cost?" }
  ]
}
```

The JSON response includes `response`, `text`, and `message` fields with the same answer so it is easy to adapt to AgentPhone's exact expected response key.

For NDJSON-style streaming, call:

```text
/webhooks/agentphone?stream=1
```

## Knowledgebase

Put approved caller-facing information in `kb/`.

Recommended files:

- `kb/company-overview.md`
- `kb/pricing.md`
- `kb/faq.md`
- `kb/support-policies.md`
- `kb/security-compliance.md`
- `kb/sales-objections.md`
- `kb/handoff-rules.md`
- `kb/competitors/*.md`

After editing the knowledgebase, run:

```bash
npm run ingest:kb
```

## Notes

- The system prompt lives in `src/prompt.ts`.
- The webhook adapter lives in `src/agentphone.ts`.
- The OpenAI call lives in `src/agent.ts`.
- If AgentPhone provides a signing secret, set `AGENTPHONE_WEBHOOK_SECRET` and confirm the exact signature header/hash format in `src/agentphone.ts`.
