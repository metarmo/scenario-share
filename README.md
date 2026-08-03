# ScenarioShare

ScenarioShare is an independent private realtime wiki and collaborative scenario editor. It is deployed as its own Vercel project and is not routed through a company website.

## Local development

Node.js 22.22.2 or newer is required.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. The production app is served from the root of its dedicated Vercel domain.

Only browser-safe Supabase connection values belong in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://hxjlmqdoqsnsmunkrtuk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

Never put a `service_role` key, OAuth secret, or other server secret in a `NEXT_PUBLIC_*` variable.

The public link is protected by a server-side shared password before Google
sign-in. Add these values only to `.env.local` and the hosting provider's secret
settings; never commit the real values:

```env
SCENARIO_SHARE_GATE_PASSWORD=REPLACE_WITH_SHARED_PASSWORD
SCENARIO_SHARE_GATE_SIGNING_SECRET=REPLACE_WITH_RANDOM_32_PLUS_CHARACTER_SECRET
```

Generate the signing secret with a cryptographically secure password manager or
`openssl rand -hex 32`. The server issues a signed, `HttpOnly` cookie that lasts
12 hours; the password is never placed in the client bundle or cookie.

## Supabase

- Project: `ScenarioShare` (`hxjlmqdoqsnsmunkrtuk`)
- Region: `ap-northeast-2`
- Migrations: `supabase/migrations/*.sql`
- Project-scoped MCP connection: `.mcp.json`

To add the MCP connection to a new Codex CLI environment:

```bash
codex mcp add supabase-scenarioshare --url 'https://mcp.supabase.com/mcp?project_ref=hxjlmqdoqsnsmunkrtuk'
codex mcp login supabase-scenarioshare
```

## Google sign-in blocker

Google authentication remains unavailable until a Google Cloud Web OAuth client is created and the Google provider is enabled in Supabase.

The OAuth client must use this callback URI:

```text
https://hxjlmqdoqsnsmunkrtuk.supabase.co/auth/v1/callback
```

Add each actual app host as an Authorized JavaScript origin. In Supabase Auth URL Configuration, use `https://scenario-share.vercel.app` as the intended Site URL and allow the exact local and production root URLs. Add approved Vercel preview URLs separately when previews need Google sign-in.

The initial owner uses a two-step bootstrap: sign in with the intended Google account once so Supabase creates the Auth user, then have a trusted Supabase administrator insert a one-time `owner` invitation using that user's UUID as `invited_by`. The user can then choose **다시 확인** to claim ownership. Every later user must also be invited by email before signing in. This prevents an arbitrary Google user from bypassing the shared-link gate and claiming ownership through the public Supabase API. Before production, disable public Realtime channel access; the client uses only private channels whose authorization is enforced through `realtime.messages` RLS.

## Collaboration model

- Tiptap/ProseMirror + Yjs handle concurrent editing and undo/redo.
- Supabase private Realtime Broadcast sends Yjs updates and Awareness cursors.
- Presence is used only for the low-frequency participant list.
- IndexedDB keeps offline changes, while an append-only Postgres update log and full snapshots restore state after reconnecting.
- Manual saves record a full Yjs snapshot and author; each document keeps its latest 30 versions.
- Public-schema tables, Storage objects, and Realtime channels are protected by workspace-membership RLS.

## Access flow

1. The public root URL redirects visitors without a valid gate
   cookie to the password screen.
2. A correct server-validated password unlocks Google sign-in for 12 hours.
3. Supabase Google Auth supplies the stable user UUID used by Yjs cursors,
   document updates, versions, comments, and attachments.
4. Workspace membership and RLS remain the data-authorization boundary; the
   shared password does not make documents anonymously readable.

Protected HTML and API responses use `private, no-store` cache headers. Hashed
JavaScript and CSS assets may remain publicly cacheable, but they contain no
shared password or ScenarioShare document data.

Because a four-digit shared password has only 10,000 combinations, production
hosting must also enforce a distributed IP rate limit or WAF rule (recommended:
five failed submissions per ten minutes). The in-process limiter is only a
bounded fallback and is not the security boundary in a multi-instance runtime.

## Verification

```bash
npm run check
npm audit
```
