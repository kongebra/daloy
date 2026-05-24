# 8-Hour · Exercise 7: OpenAPI Auto-Docs & Tuning

Your `/docs` page is the most important page in your API. Treat it like marketing copy: it's what consumers see _before_ they decide whether to integrate.

## Requirements

- Populate the supported `openapi.info` fields: `title`, `version`, `description`.
- Add `servers` (at least one local + one production URL).
- Add route-level `summary`, `description`, and `tags`.
- Add `securitySchemes` if your docs need to show bearer/API-key auth.
- Confirm the rendered `/docs` page shows the branding.

## Verify

```bash
curl -s http://localhost:3000/openapi.json | jq '.info, .servers, .components.securitySchemes'
open http://localhost:3000/docs
```

The Scalar UI now shows:

- A "Servers" dropdown for switching between local and prod.
- A clear API description.
- Route summaries/descriptions grouped by tags.
- Auth scheme controls when a route declares `auth`.

## Why This Matters

Every field you populate is a question your consumers don't have to ask in Slack:

- **`servers`**: "what's the base URL?"
- **route `summary`/`description`**: "what does this operation do?"
- **route `tags`**: "where should this operation be grouped?"
- **`securitySchemes`**: "what credential shape does this API expect?"

All free. All in the same file you're already writing.

## Training Resources

- [DaloyJS — OpenAPI](https://daloyjs.dev/docs/openapi)
- [OpenAPI 3.1 — Info Object](https://spec.openapis.org/oas/v3.1.0#info-object)
- [Scalar — API reference renderer](https://github.com/scalar/scalar)
