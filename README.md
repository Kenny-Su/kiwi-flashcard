# Kiwi Flashcard App

External Kiwi App plugin for student flashcards. It embeds in Kiwi as a class tab, verifies Kiwi app-scoped JWTs via JWKS, stores flashcards in SQLite, and uses Kiwi-approved prompts for AI generation. The backend is a small Express server using Node's built-in SQLite module and the official MCP SDK.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

During development, Vite serves the app at `http://localhost:8002/student` and proxies `/api/*` to the Express server on port `8003`. A production build serves both the UI and API from Express on port `8002`.

Node.js 24 or newer is required. The SQLite database is created automatically at `data/flashcards.db`; set `DATABASE_PATH` to use a different location.

## Register With Kiwi

1. In Kiwi admin, whitelist slug `flashcards` with the registration secret and max scopes `llm:prompt:*`, `class:info:read`, `user:profile:read`.
2. Run:

```bash
npm run register
```

3. Include `context:student_learning:read` and `class:materials:chunks:read` in the app's max and enabled scopes, then approve the app's prompts in Kiwi admin. The flashcard creator uses Kiwi's host-proxied `contextualChat` operation, so private learning context stays inside Kiwi and only generated card drafts reach this app.
4. Enable the app for a class.

The registration also adds a class-scoped **Flashcard Manager** admin surface for
instructors, TAs, and administrators. On current Kiwi UI builds it contributes
Overview, Decks, and Card library entries to the host admin sidebar.

## Class Materials Scope

"Generate from class materials" reads the text Kiwi already parsed from a class's
documents, through `GET /api/kiwi-apps/classes/:classId/document-chunks`. It needs
the `class:materials:chunks:read` scope, granted in two places:

1. **Whitelist (system-wide ceiling)** — `/admin/kiwi-apps` → edit the `flashcards`
   whitelist entry → add `class:materials:chunks:read` to max scopes. The API form
   replaces the whole array, so send the existing scopes too:

```bash
curl -X PATCH "$KIWI_API_URL/api/kiwi-apps/whitelist/flashcards" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"maxScopes":["llm:prompt:*","class:info:read","user:profile:read","context:student_learning:read","class:materials:chunks:read"]}'
```

2. **Per class** — in the class's Kiwi Apps settings, tick the new scope. This is
   only needed if that class has an explicit `enabledScopes` list; an empty list
   already means "all max scopes".

Effective scopes are `intersection(maxScopes, enabledScopes)` plus approved prompt
scopes, resolved when the host mints an app token. Tokens live an hour, so students
holding one from before the grant see the feature as "Needs setup" until they
reload. Re-registering the app is not required.

Cards built this way record `materialType: 'class-material'`, and a single-document
selection also records that document's ID as `pdfId`.

For staging, set `FLASHCARD_APP_URL` to the HTTPS Cloudflare Tunnel URL before running `npm run register`. Vite already accepts `*.trycloudflare.com` hosts and proxies `/api` to the local Express process.
