# ScenarioShare project context

## Scope

This repository contains only ScenarioShare, the private realtime wiki and collaborative editor used by METARMO and Plazma. Do not add METARMO company-site pages or shared company-site UI here.

## Current architecture

- Next.js 16 App Router with `basePath: "/scenario-share"`; the app is served at `/scenario-share`.
- Tiptap + Yjs for rich-text CRDT collaboration.
- Supabase Auth, Postgres, Storage, and private Realtime channels.
- IndexedDB preserves offline edits; Postgres snapshots and an append-only update log restore sessions.
- Workspace membership and RLS protect documents, comments, versions, attachments, and Realtime messages.
- Supabase project ref: `hxjlmqdoqsnsmunkrtuk`.
- Intended public URL: `https://www.metarmo.com/scenario-share`.

## Important external blocker

Google sign-in cannot work until a Google Web OAuth client is created and the Google provider is enabled in Supabase. Never invent or commit OAuth credentials. Keep real credentials in `.env.local` or the external secret manager.

## Commands

```bash
npm ci
npm run dev
npm run check
```

Node.js 22.22.2 or newer is required. Browser-safe Supabase values belong in `NEXT_PUBLIC_*`; never expose a service-role or secret key.

## Change boundaries

- Preserve Yjs convergence, offline recovery, membership checks, private-channel authorization, and RLS guarantees.
- Add database changes as new files under `supabase/migrations`; do not rewrite migrations that may already be applied.
- Keep the `/scenario-share` base path working unless deployment routing is intentionally migrated in the same change.
- Run lint, unit tests, and a production build before publishing.
