# ycagentphone

Prototype restaurant phone Q&A agent for AgentPhone webhooks backed by a Supermemory knowledgebase.

## Architecture

```text
Caller
  -> AgentPhone phone number
  -> AgentPhone webhook
  -> Express service
  -> Supermemory search
  -> OpenAI Responses API
  -> AgentPhone speaks the answer
```

Codex is useful as the builder and maintenance harness. The live call path is this service.

## Setup

```bash
cd ~/Development/ycagentphone
bun install
cp .env.example .env
```

Edit `.env` and set:

```bash
OPENAI_API_KEY=...
SUPERMEMORY_API_KEY=...
COMPANY_NAME=...
PUBLIC_CONTACT_EMAIL=...
```

Then seed the Supermemory knowledgebase:

```bash
bun run ingest:kb
```

The default container tag is `ycagentphone-kb`. Override `SUPERMEMORY_CONTAINER_TAG` in `.env` if you want to use a different memory space.

## Run Locally

```bash
bun run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Local turn test through HTTP:

```bash
curl -X POST http://localhost:3000/test/turn \
  -H 'content-type: application/json' \
  -d '{"transcript":"Do you have a private dining menu for 14 people?"}'
```

Local turn test through the script:

```bash
bun run test:turn -- "Do you have gluten-free pasta?"
```

Signed local webhook test:

```bash
bun run test:webhook -- "Can I book a birthday dinner for 12 people?"
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
  "transcript": "Can I book a birthday dinner for 12 people?"
}
```

and:

```json
{
  "call": { "id": "call_123", "from": "+15551234567" },
  "messages": [
    { "role": "caller", "content": "Do you accommodate nut allergies?" }
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

- `kb/restaurant-overview.md`
- `kb/menu.md`
- `kb/food-modifications.md`
- `kb/allergy-practices.md`
- `kb/large-party-policy.md`
- `kb/prix-fixe-large-parties.md`
- `kb/chef-and-owners.md`
- `kb/reservation-inquiry-large-party.md`
- `kb/faq.md`
- `kb/handoff-rules.md`
- `kb/competitors/*.md`

After editing the knowledgebase, run:

```bash
bun run ingest:kb
```

## Notes

- The system prompt lives in `src/prompt.ts`.
- The webhook adapter lives in `src/agentphone.ts`.
- The OpenAI call lives in `src/agent.ts`.
- Supermemory retrieval lives in `src/memory.ts`.
- If AgentPhone provides a signing secret, set `AGENTPHONE_WEBHOOK_SECRET` and confirm the exact signature header/hash format in `src/agentphone.ts`.
