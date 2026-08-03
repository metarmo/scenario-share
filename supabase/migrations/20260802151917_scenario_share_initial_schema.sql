-- ScenarioShare initial schema
--
-- Authorization never relies on public.profiles or auth user metadata. Auth
-- metadata is copied only for display name/avatar; profiles.email is copied
-- from auth.users.email only so workspace members can render collaborator UI.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create type public.workspace_role as enum ('owner', 'editor', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text
    check (
      email is null
      or (
        email = lower(btrim(email))
        and char_length(email) between 3 and 320
      )
    ),
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
  role public.workspace_role not null check (role <> 'owner'),
  invited_by uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((accepted_at is null) = (accepted_by is null)),
  check ((revoked_at is null) = (revoked_by is null)),
  check (not (accepted_at is not null and revoked_at is not null))
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  slug text not null
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  sort_order integer not null default 0,
  plain_text text not null default '',
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  created_by uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  updated_by uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, parent_id)
    references public.documents (workspace_id, id)
    on delete restrict,
  check (parent_id is null or parent_id <> id),
  check ((archived_at is null) = (archived_by is null))
);

create table public.document_updates (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  yjs_update text not null
    check (
      char_length(yjs_update) > 0
      and char_length(yjs_update) % 4 = 0
      and yjs_update ~ '^[A-Za-z0-9+/]+={0,2}$'
    ),
  created_by uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  client_id uuid not null,
  client_seq bigint not null check (client_seq >= 0),
  created_at timestamptz not null default now(),
  unique (document_id, client_id, client_seq)
);

create table public.document_versions (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  yjs_state text not null
    check (
      char_length(yjs_state) > 0
      and char_length(yjs_state) % 4 = 0
      and yjs_state ~ '^[A-Za-z0-9+/]+={0,2}$'
    ),
  content jsonb not null default '{}'::jsonb,
  plain_text text not null default '',
  last_update_id bigint,
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  parent_id uuid,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  quote text
    check (quote is null or char_length(quote) between 1 and 1000),
  anchor_start text
    check (
      anchor_start is null
      or (
        char_length(anchor_start) > 0
        and char_length(anchor_start) % 4 = 0
        and anchor_start ~ '^[A-Za-z0-9+/]+={0,2}$'
      )
    ),
  anchor_end text
    check (
      anchor_end is null
      or (
        char_length(anchor_end) > 0
        and char_length(anchor_end) % 4 = 0
        and anchor_end ~ '^[A-Za-z0-9+/]+={0,2}$'
      )
    ),
  author_id uuid not null default auth.uid()
    references public.profiles (id) on delete restrict,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, id),
  foreign key (document_id, parent_id)
    references public.comments (document_id, id)
    on delete cascade,
  check (anchor_end is null or anchor_start is not null),
  check ((resolved_at is null) = (resolved_by is null))
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  object_path text not null unique
    check (
      char_length(object_path) between 3 and 1024
      and object_path !~ '^/'
      and position('..' in object_path) = 0
    ),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null default auth.uid()
    references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on column public.document_updates.yjs_update is
  'A standard base64-encoded binary Yjs update. Rows are append-only to API clients.';
comment on column public.document_versions.yjs_state is
  'A standard base64-encoded full Yjs state snapshot.';
comment on column public.document_versions.last_update_id is
  'High-water document_updates.id included in this snapshot; older updates are garbage-collected.';
comment on column public.comments.anchor_start is
  'Optional standard base64-encoded serialized Y.RelativePosition.';
comment on column public.comments.anchor_end is
  'Optional standard base64-encoded serialized Y.RelativePosition for a range end.';
comment on column public.attachments.object_path is
  'Storage key: <workspace_uuid>/<document_uuid>/<attachment_uuid>/<filename>.';

-- The workspace id is intentionally stable so clients can safely seed routes and
-- attachment paths without discovering a new id per environment.
insert into public.workspaces (id, slug, name)
values (
  '7e6c704d-7f6b-4a0c-b340-23b0469fc594',
  'scenario-share',
  'ScenarioShare'
)
on conflict (slug) do update
set name = excluded.name;

create unique index workspace_invites_one_pending_email_idx
  on public.workspace_invites (workspace_id, email)
  where accepted_at is null and revoked_at is null;
create index workspace_invites_lookup_idx
  on public.workspace_invites (workspace_id, email, expires_at)
  where accepted_at is null and revoked_at is null;
create index workspace_invites_invited_by_idx
  on public.workspace_invites (invited_by);
create index workspace_invites_accepted_by_idx
  on public.workspace_invites (accepted_by)
  where accepted_by is not null;
create index workspace_invites_revoked_by_idx
  on public.workspace_invites (revoked_by)
  where revoked_by is not null;
create index workspace_members_user_idx
  on public.workspace_members (user_id, workspace_id);
create index workspace_members_role_idx
  on public.workspace_members (workspace_id, role);
create unique index documents_live_sibling_slug_idx
  on public.documents (
    workspace_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(slug)
  )
  where archived_at is null;
create index documents_tree_idx
  on public.documents (workspace_id, parent_id, sort_order, title);
create index documents_updated_at_idx
  on public.documents (workspace_id, updated_at desc);
create index documents_archived_idx
  on public.documents (workspace_id, archived_at)
  where archived_at is not null;
create index documents_created_by_idx
  on public.documents (created_by);
create index documents_updated_by_idx
  on public.documents (updated_by);
create index documents_archived_by_idx
  on public.documents (archived_by)
  where archived_by is not null;
create index document_updates_stream_idx
  on public.document_updates (document_id, id);
create index document_updates_created_at_idx
  on public.document_updates (document_id, created_at);
create index document_updates_created_by_idx
  on public.document_updates (created_by);
create index document_versions_history_idx
  on public.document_versions (document_id, created_at desc, id desc);
create index document_versions_author_idx
  on public.document_versions (author_id);
create index comments_thread_idx
  on public.comments (document_id, parent_id, created_at);
create index comments_unresolved_idx
  on public.comments (document_id, created_at)
  where resolved_at is null;
create index comments_author_idx
  on public.comments (author_id);
create index comments_resolved_by_idx
  on public.comments (resolved_by)
  where resolved_by is not null;
create index attachments_document_idx
  on public.attachments (document_id, created_at);
create index attachments_uploaded_by_idx
  on public.attachments (uploaded_by);

-- Security-definer helpers live outside exposed schemas. Each helper pins its
-- search_path, resolves auth.uid() itself, and returns only a boolean decision.
create function private.has_workspace_role(
  p_workspace_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = (select auth.uid())
      and member.role = any (p_roles)
  );
$$;

create function private.has_document_role(
  p_document_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents as document
    join public.workspace_members as member
      on member.workspace_id = document.workspace_id
    where document.id = p_document_id
      and member.user_id = (select auth.uid())
      and member.role = any (p_roles)
  );
$$;

create function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) = p_profile_id
    or exists (
      select 1
      from public.workspace_members as own_membership
      join public.workspace_members as other_membership
        on other_membership.workspace_id = own_membership.workspace_id
      where own_membership.user_id = (select auth.uid())
        and other_membership.user_id = p_profile_id
    );
$$;

create function private.can_access_document_topic(
  p_topic text,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents as document
    join public.workspace_members as member
      on member.workspace_id = document.workspace_id
    where p_topic = 'doc:' || document.id::text
      and member.user_id = (select auth.uid())
      and member.role = any (p_roles)
  );
$$;

create function private.can_access_attachment_object(
  p_object_name text,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents as document
    join public.workspace_members as member
      on member.workspace_id = document.workspace_id
    where split_part(p_object_name, '/', 1) = document.workspace_id::text
      and split_part(p_object_name, '/', 2) = document.id::text
      and split_part(p_object_name, '/', 3) <> ''
      and member.user_id = (select auth.uid())
      and member.role = any (p_roles)
  );
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.prepare_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  new.updated_at := now();

  if v_user_id is not null then
    new.updated_by := v_user_id;
  end if;

  if new.archived_at is distinct from old.archived_at then
    if new.archived_at is null then
      new.archived_by := null;
    elsif v_user_id is not null then
      new.archived_by := v_user_id;
    end if;
  end if;

  return new;
end;
$$;

create function private.prepare_invite_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  new.email := lower(btrim(new.email));
  new.updated_at := now();

  if tg_op = 'UPDATE' and new.revoked_at is distinct from old.revoked_at then
    if new.revoked_at is null then
      new.revoked_by := null;
    elsif v_user_id is not null then
      new.revoked_by := v_user_id;
    end if;
  end if;

  return new;
end;
$$;

create function private.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    lower(btrim(new.email)),
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Member'
      ),
      120
    ),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'picture'), '')
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      updated_at = now();

  return new;
end;
$$;

create function private.validate_comment_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_parent_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.anchor_start is not null or new.anchor_end is not null then
    raise exception using
      errcode = '23514',
      message = 'replies cannot define their own relative-position anchor';
  end if;

  select parent.parent_id
    into v_parent_parent_id
  from public.comments as parent
  where parent.document_id = new.document_id
    and parent.id = new.parent_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'comment parent does not exist in this document';
  end if;

  if v_parent_parent_id is not null then
    raise exception using
      errcode = '23514',
      message = 'comment replies are limited to one level';
  end if;

  return new;
end;
$$;

create function private.maintain_document_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('scenario-share-version:' || new.document_id::text, 0)
  );

  if new.last_update_id is not null
     and not exists (
       select 1
       from public.document_updates as document_update
       where document_update.document_id = new.document_id
         and document_update.id = new.last_update_id
     )
     and not exists (
       -- Saving an unchanged document may reuse the latest checkpoint after its
       -- source update row has already been compacted.
       select 1
       from public.document_versions as prior_version
       where prior_version.document_id = new.document_id
         and prior_version.last_update_id = new.last_update_id
         and prior_version.id <> new.id
     ) then
    raise exception using
      errcode = '23503',
      message = 'last_update_id must reference an update for the same document';
  end if;

  if new.last_update_id is not null then
    delete from public.document_updates
    where document_id = new.document_id
      and id <= new.last_update_id;
  end if;

  delete from public.document_versions as old_version
  where old_version.id in (
    select version_to_remove.id
    from public.document_versions as version_to_remove
    where version_to_remove.document_id = new.document_id
    order by version_to_remove.created_at desc, version_to_remove.id desc
    offset 30
  );

  return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function private.set_updated_at();

create trigger workspace_invites_prepare_write
before insert or update on public.workspace_invites
for each row execute function private.prepare_invite_write();

create trigger documents_prepare_update
before update on public.documents
for each row execute function private.prepare_document_update();

create trigger comments_set_updated_at
before update on public.comments
for each row execute function private.set_updated_at();

create trigger comments_validate_thread
before insert on public.comments
for each row execute function private.validate_comment_thread();

create trigger document_versions_maintain_history
after insert on public.document_versions
for each row execute function private.maintain_document_versions();

create trigger auth_users_sync_profile
after insert or update of raw_user_meta_data, email on auth.users
for each row execute function private.sync_profile_from_auth();

-- Backfill display-only profiles if this migration is installed into a project
-- that already has Auth users.
insert into public.profiles (id, email, display_name, avatar_url)
select
  auth_user.id,
  lower(btrim(auth_user.email)),
  left(
    coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
      'Member'
    ),
    120
  ),
  coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'picture'), '')
  )
from auth.users as auth_user
on conflict (id) do nothing;

-- First verified Google user claims ownership. Once any membership exists, a
-- user can join only through a live invite matching the verified Google email.
create function public.claim_scenario_share_workspace()
returns table (
  workspace_id uuid,
  user_id uuid,
  role public.workspace_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_workspace_id uuid;
  v_role public.workspace_role;
  v_invite_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into v_email, v_email_confirmed_at
  from auth.users as auth_user
  where auth_user.id = v_user_id;

  if v_email is null or v_email_confirmed_at is null then
    raise exception using
      errcode = '42501',
      message = 'a verified Google email is required';
  end if;

  if not exists (
    select 1
    from auth.identities as identity
    where identity.user_id = v_user_id
      and identity.provider = 'google'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ScenarioShare membership requires Google sign-in';
  end if;

  select workspace.id
    into v_workspace_id
  from public.workspaces as workspace
  where workspace.slug = 'scenario-share';

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ScenarioShare workspace seed is missing';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('scenario-share-claim:' || v_workspace_id::text, 0)
  );

  select member.role
    into v_role
  from public.workspace_members as member
  where member.workspace_id = v_workspace_id
    and member.user_id = v_user_id;

  if found then
    return query select v_workspace_id, v_user_id, v_role;
    return;
  end if;

  if not exists (
    select 1
    from public.workspace_members as existing_member
    where existing_member.workspace_id = v_workspace_id
  ) then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_workspace_id, v_user_id, 'owner');

    v_role := 'owner';

    return query select v_workspace_id, v_user_id, v_role;
    return;
  end if;

  select invitation.id, invitation.role
    into v_invite_id, v_role
  from public.workspace_invites as invitation
  where invitation.workspace_id = v_workspace_id
    and invitation.email = v_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
  order by invitation.created_at
  limit 1
  for update;

  if v_invite_id is null then
    raise exception using
      errcode = '42501',
      message = 'no active ScenarioShare invitation matches this Google email';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, v_role);

  update public.workspace_invites
  set accepted_at = now(),
      accepted_by = v_user_id,
      updated_at = now()
  where id = v_invite_id;

  return query select v_workspace_id, v_user_id, v_role;
end;
$$;

create function public.set_comment_resolved(
  p_comment_id uuid,
  p_resolved boolean
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment public.comments;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select comment.*
    into v_comment
  from public.comments as comment
  where comment.id = p_comment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'comment not found';
  end if;

  if v_comment.parent_id is not null then
    raise exception using errcode = '23514', message = 'only root comments can be resolved';
  end if;

  if not private.has_document_role(
    v_comment.document_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  ) then
    raise exception using errcode = '42501', message = 'workspace membership required';
  end if;

  if v_comment.author_id <> v_user_id
     and not private.has_document_role(
       v_comment.document_id,
       array['owner', 'editor']::public.workspace_role[]
     ) then
    raise exception using errcode = '42501', message = 'comment resolve permission denied';
  end if;

  update public.comments
  set resolved_at = case when p_resolved then now() else null end,
      resolved_by = case when p_resolved then v_user_id else null end
  where id = p_comment_id
  returning * into v_comment;

  return v_comment;
end;
$$;

-- RLS is enabled on every table in the exposed public schema.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.documents enable row level security;
alter table public.document_updates enable row level security;
alter table public.document_versions enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;

create policy profiles_select_shared_workspace
on public.profiles
for select
to authenticated
using (private.can_view_profile(id));

create policy workspaces_select_members
on public.workspaces
for select
to authenticated
using (
  private.has_workspace_role(
    id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy workspaces_update_owners
on public.workspaces
for update
to authenticated
using (private.has_workspace_role(id, array['owner']::public.workspace_role[]))
with check (private.has_workspace_role(id, array['owner']::public.workspace_role[]));

create policy workspace_members_select_members
on public.workspace_members
for select
to authenticated
using (
  private.has_workspace_role(
    workspace_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy workspace_members_update_owners
on public.workspace_members
for update
to authenticated
using (
  private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  and user_id <> (select auth.uid())
)
with check (
  private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  and user_id <> (select auth.uid())
);

create policy workspace_members_delete_owners
on public.workspace_members
for delete
to authenticated
using (
  private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[])
  and user_id <> (select auth.uid())
);

create policy workspace_invites_select_editors
on public.workspace_invites
for select
to authenticated
using (
  private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy workspace_invites_insert_editors
on public.workspace_invites
for insert
to authenticated
with check (
  invited_by = (select auth.uid())
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy workspace_invites_update_editors
on public.workspace_invites
for update
to authenticated
using (
  private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy workspace_invites_delete_pending_editors
on public.workspace_invites
for delete
to authenticated
using (
  accepted_at is null
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy documents_select_members
on public.documents
for select
to authenticated
using (
  private.has_workspace_role(
    workspace_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy documents_insert_editors
on public.documents
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy documents_update_editors
on public.documents
for update
to authenticated
using (
  private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  updated_by = (select auth.uid())
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy document_updates_select_members
on public.document_updates
for select
to authenticated
using (
  private.has_document_role(
    document_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy document_updates_insert_editors
on public.document_updates
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy document_versions_select_members
on public.document_versions
for select
to authenticated
using (
  private.has_document_role(
    document_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy document_versions_insert_editors
on public.document_versions
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy comments_select_members
on public.comments
for select
to authenticated
using (
  private.has_document_role(
    document_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy comments_insert_editors
on public.comments
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy comments_update_own
on public.comments
for update
to authenticated
using (
  author_id = (select auth.uid())
  and private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  author_id = (select auth.uid())
  and private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy attachments_select_members
on public.attachments
for select
to authenticated
using (
  private.has_document_role(
    document_id,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy attachments_insert_editors
on public.attachments
for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy attachments_delete_editors
on public.attachments
for delete
to authenticated
using (
  private.has_document_role(
    document_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

-- Explicit Data API grants are required for projects using the 2026 opt-in
-- exposure defaults. RLS remains the row-level authorization boundary.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to authenticated;
grant usage on type public.workspace_role to authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.workspaces to authenticated;
grant update (name) on table public.workspaces to authenticated;
grant select on table public.workspace_members to authenticated;
grant update (role), delete on table public.workspace_members to authenticated;
grant select on table public.workspace_invites to authenticated;
grant insert (workspace_id, email, role, expires_at)
  on table public.workspace_invites to authenticated;
grant update (role, expires_at, revoked_at)
  on table public.workspace_invites to authenticated;
grant delete on table public.workspace_invites to authenticated;
grant select on table public.documents to authenticated;
grant insert (workspace_id, parent_id, title, slug, sort_order, plain_text)
  on table public.documents to authenticated;
grant update (parent_id, title, slug, sort_order, plain_text, archived_at)
  on table public.documents to authenticated;
grant select on table public.document_updates to authenticated;
grant insert (document_id, yjs_update, client_id, client_seq)
  on table public.document_updates to authenticated;
grant select on table public.document_versions to authenticated;
grant insert (document_id, title, label, yjs_state, content, plain_text, last_update_id)
  on table public.document_versions to authenticated;
grant select on table public.comments to authenticated;
grant insert (document_id, parent_id, body, quote, anchor_start, anchor_end)
  on table public.comments to authenticated;
grant update (body) on table public.comments to authenticated;
grant select on table public.attachments to authenticated;
grant insert (document_id, object_path, file_name, mime_type, size_bytes)
  on table public.attachments to authenticated;
grant delete on table public.attachments to authenticated;
grant usage, select on sequence public.document_updates_id_seq to authenticated;
grant usage, select on sequence public.document_versions_id_seq to authenticated;

grant all privileges on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.workspace_invites,
  public.documents,
  public.document_updates,
  public.document_versions,
  public.comments,
  public.attachments
to service_role;
grant usage, select on sequence
  public.document_updates_id_seq,
  public.document_versions_id_seq
to service_role;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[])
  to authenticated;
grant execute on function private.has_document_role(uuid, public.workspace_role[])
  to authenticated;
grant execute on function private.can_view_profile(uuid)
  to authenticated;
grant execute on function private.can_access_document_topic(text, public.workspace_role[])
  to authenticated;
grant execute on function private.can_access_attachment_object(text, public.workspace_role[])
  to authenticated;

revoke all on function public.claim_scenario_share_workspace()
  from public, anon;
revoke all on function public.set_comment_resolved(uuid, boolean)
  from public, anon;
grant execute on function public.claim_scenario_share_workspace()
  to authenticated;
grant execute on function public.set_comment_resolved(uuid, boolean)
  to authenticated;

-- Postgres Changes powers sidebar/document/comment metadata refreshes. The DO
-- block keeps resets and replays safe if a table is already in the publication.
do $$
declare
  v_table_name text;
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach v_table_name in array array[
      'documents',
      'comments',
      'workspace_members'
    ]
    loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table_name
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          v_table_name
        );
      end if;
    end loop;
  end if;
end;
$$;

-- Private Realtime Broadcast/Presence channels use the topic doc:<uuid>.
-- Members may subscribe; only owners/editors may publish cursor, presence, and
-- Yjs synchronization messages.
create policy scenario_share_document_channel_read
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and private.can_access_document_topic(
    (select realtime.topic()),
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy scenario_share_document_channel_write
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and private.can_access_document_topic(
    (select realtime.topic()),
    array['owner', 'editor']::public.workspace_role[]
  )
);

-- Storage is private and keys are scoped to a workspace/document pair.
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'scenario-share-attachments',
  'scenario-share-attachments',
  false,
  52428800
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy scenario_share_attachments_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'scenario-share-attachments'
  and private.can_access_attachment_object(
    name,
    array['owner', 'editor', 'viewer']::public.workspace_role[]
  )
);

create policy scenario_share_attachments_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'scenario-share-attachments'
  and private.can_access_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy scenario_share_attachments_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'scenario-share-attachments'
  and private.can_access_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  bucket_id = 'scenario-share-attachments'
  and private.can_access_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
);

create policy scenario_share_attachments_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'scenario-share-attachments'
  and private.can_access_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
);
