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

3. Include `context:student_learning:read` in the app's max and enabled scopes, then approve the app's prompts in Kiwi admin. The flashcard creator uses Kiwi's host-proxied `contextualChat` operation, so private learning context stays inside Kiwi and only generated card drafts reach this app.
4. Enable the app for a class.

For staging, set `FLASHCARD_APP_URL` to the HTTPS Cloudflare Tunnel URL before running `npm run register`. Vite already accepts `*.trycloudflare.com` hosts and proxies `/api` to the local Express process.
