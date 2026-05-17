# ycagentphone

Prototype restaurant phone Q&A agent for AgentPhone webhooks backed by a Moss knowledgebase.

## Architecture

```text
Caller
  -> AgentPhone phone number
  -> AgentPhone webhook
  -> Express service
  -> Call skill matching
  -> Moss search
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
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
MOSS_PROJECT_ID=...
MOSS_PROJECT_KEY=...
MOSS_INDEX_NAME=ycagentphone-restaurant-kb
AGENTPHONE_API_KEY=...
AGENTPHONE_AGENT_ID=...
AGENTPHONE_WEBHOOK_BASE_URL=...
COMPANY_NAME=...
RESTAURANT_GREETING="Good evening, and thank you for calling. This is the restaurant's virtual host. How may I help you today?"
RESTAURANT_PROCESSING_MESSAGE="Of course. Let me check that for you."
PUBLIC_CONTACT_EMAIL=...
```

Then seed the Moss knowledgebase:

```bash
bun run ingest:kb
```

The default Moss index is `ycagentphone-restaurant-kb`. Override `MOSS_INDEX_NAME` in `.env` if you want to use a different knowledge space. Retrieval uses hybrid search by default with `MOSS_SEARCH_ALPHA=0.8`, where `1.0` is semantic-only and `0.0` is keyword-only.

Langfuse tracing is enabled automatically when `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL` are set. Each answered turn is traced as `agentphone.answer`, with Moss retrieval and the OpenAI Responses API call captured underneath it.

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

Use a stable public URL for AgentPhone. With ngrok, reserve a static domain in the ngrok dashboard, then run:

```bash
ngrok http --url=YOUR-STATIC-DOMAIN.ngrok-free.app 127.0.0.1:3000
```

Set the stable base URL in `.env`:

```bash
AGENTPHONE_WEBHOOK_BASE_URL=https://YOUR-STATIC-DOMAIN.ngrok-free.app
```

Configure AgentPhone from that constant:

```bash
bun run configure:webhook
```

That script configures AgentPhone to call:

```text
${AGENTPHONE_WEBHOOK_BASE_URL}/webhooks/agentphone
```

It also updates `AGENTPHONE_WEBHOOK_SECRET` in `.env` with the returned AgentPhone signing secret.
Restart the webhook server after running this command so signature verification uses the new secret.

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
- Call skills live in `src/skills/`. The reservation-taking flow is `src/skills/reservation-taking.ts`.
- The webhook adapter lives in `src/agentphone.ts`.
- The OpenAI call lives in `src/agent.ts`.
- Moss retrieval lives in `src/memory.ts`.
- If AgentPhone provides a signing secret, set `AGENTPHONE_WEBHOOK_SECRET` and confirm the exact signature header/hash format in `src/agentphone.ts`.
