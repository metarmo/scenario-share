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

## Google sign-in and account allowlist

Google authentication remains unavailable until a Google Cloud Web OAuth client is created and the Google provider is enabled in Supabase.

The OAuth client must use this callback URI:

```text
https://hxjlmqdoqsnsmunkrtuk.supabase.co/auth/v1/callback
```

Add each actual app host as an Authorized JavaScript origin. In Supabase Auth URL Configuration, use `https://scenario-share.vercel.app` as the intended Site URL and allow the exact local and production root URLs. Add approved Vercel preview URLs separately when previews need Google sign-in.

Only these Google accounts are allowed:

- `kevin34320710@gmail.com` (`owner`)
- `nekoya404@gmail.com` (`editor`)

Supabase's `before_user_created` hook rejects every other account before it is
created, and the `custom_access_token` hook rejects token issuance and refreshes
for every other email. The claim RPC automatically provisions the two allowed
accounts with the roles above. The client repeats the allowlist check only for
immediate UX; Auth hooks and database policies are the security boundaries.

The hook functions are installed by the latest migration and enabled locally in
`supabase/config.toml`. For a hosted project, enable both Postgres hooks under
**Authentication > Hooks** (or deploy the matching project configuration) after
the migration is applied.

Before production, disable public Realtime channel access; the client uses only private channels whose authorization is enforced through `realtime.messages` RLS.

## Collaboration model

- Tiptap/ProseMirror + Yjs handle concurrent body editing and undo/redo; the
  document title is a shared Y.Text in the same Y.Doc so title edits converge too.
- Supabase private Realtime Broadcast sends Yjs updates and Awareness cursors.
- Presence is used only for the low-frequency participant list.
- IndexedDB makes cached documents available immediately. Postgres accepts append-only Yjs updates, while private canonical snapshots atomically compact only updates already incorporated into a verified state.
- Manual saves record a full Yjs snapshot and author; each document keeps its latest 30 versions.
- Public-schema tables, Storage objects, and Realtime channels are protected by workspace-membership RLS.

## Access flow

1. The root URL shows Google sign-in directly; there is no shared password or
   PIN gate.
2. Supabase Auth issues a session only when the normalized Google email exactly
   matches one of the two approved accounts.
3. Supabase Google Auth supplies the stable user UUID used by Yjs cursors,
   document updates, versions, comments, and attachments.
4. The claim RPC provisions the approved account, while Postgres, Storage, and
   private Realtime RLS re-check both account allowlisting and workspace role.

Protected HTML and API responses use `private, no-store` cache headers. Hashed
JavaScript and CSS assets may remain publicly cacheable, but they contain no
ScenarioShare document data.

## Verification

```bash
npm run check
npm audit
```
