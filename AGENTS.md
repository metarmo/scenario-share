# ScenarioShare project context

## Scope

This repository contains only ScenarioShare, an independent private realtime wiki and collaborative editor. It is not part of the METARMO company site and must remain independently deployed and branded.

## Current architecture

- Next.js 16 App Router served from the deployment root.
- Tiptap + Yjs for rich-text CRDT collaboration.
- Supabase Auth, Postgres, Storage, and private Realtime channels.
- IndexedDB preserves offline edits; Postgres snapshots and an append-only update log restore sessions.
- Workspace membership and RLS protect documents, comments, versions, attachments, and Realtime messages.
- Supabase project ref: `hxjlmqdoqsnsmunkrtuk`.
- Intended public URL: `https://scenario-share.vercel.app`.

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
- Keep the app on its independent root URL; do not add company-domain rewrites or shared company-site UI.
- Run lint, unit tests, and a production build before publishing.
