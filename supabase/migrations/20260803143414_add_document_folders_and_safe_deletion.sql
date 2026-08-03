-- Add folders as lightweight nodes in the existing document tree. Existing
-- rows keep the default `document` type, so their ids, Yjs updates, versions,
-- comments, and attachment metadata are not rewritten.

set lock_timeout = '5s';

alter table public.documents
  add column item_type text not null default 'document';

alter table public.documents
  add column deletion_token uuid;

alter table public.documents
  add constraint documents_item_type_check
  check (item_type in ('document', 'folder'))
  not valid;

alter table public.documents
  validate constraint documents_item_type_check;

comment on column public.documents.item_type is
  'Tree node type. Folder rows organize descendants and must never open a Yjs document session.';

comment on column public.documents.deletion_token is
  'Durable deletion intent. While set, the subtree is frozen until the same permanent deletion is retried and finalized.';

create index documents_deletion_token_idx
  on public.documents (deletion_token)
  where deletion_token is not null;

create table private.document_deletion_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  root_item_id uuid not null,
  item_ids uuid[] not null,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, root_item_id),
  check (cardinality(item_ids) > 0),
  check (jsonb_typeof(attachments) = 'array')
);

revoke all on table private.document_deletion_intents
  from public, anon, authenticated;

-- Deleting a folder or a legacy parent document deletes its complete subtree.
-- This changes behavior only for an explicit delete; existing rows are left in
-- place when the migration is applied.
alter table public.documents
  drop constraint documents_workspace_id_parent_id_fkey;

alter table public.documents
  add constraint documents_workspace_id_parent_id_fkey
  foreign key (workspace_id, parent_id)
  references public.documents (workspace_id, id)
  on delete cascade;

-- A database cascade cannot remove the underlying Storage object. Keep the
-- attachment metadata as a guard until the app has successfully deleted each
-- file through the Storage API.
alter table public.attachments
  drop constraint attachments_document_id_fkey;

alter table public.attachments
  add constraint attachments_document_id_fkey
  foreign key (document_id)
  references public.documents (id)
  on delete restrict;

create function private.validate_attachment_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  v_workspace_id uuid;
  v_deletion_token uuid;
begin
  select document.workspace_id
    into v_workspace_id
  from public.documents as document
  where document.id = v_document_id;

  if v_workspace_id is null then
    raise exception using errcode = '23503', message = 'attachment document does not exist';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'scenario-share-tree:' || v_workspace_id::text,
      0
    )
  );

  select document.deletion_token
    into v_deletion_token
  from public.documents as document
  where document.id = v_document_id
  for key share;

  if not found then
    raise exception using errcode = '23503', message = 'attachment document does not exist';
  end if;

  if v_deletion_token is not null
    and not (
      tg_op = 'DELETE'
      and current_setting('scenario_share.deletion_token', true) = v_deletion_token::text
    )
  then
    raise exception using
      errcode = '55000',
      message = 'the attachment document is pending permanent deletion';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.validate_attachment_write()
  from public, anon, authenticated;

create trigger attachments_validate_write
before insert or update or delete on public.attachments
for each row execute function private.validate_attachment_write();

create function private.validate_document_parent_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'scenario-share-tree:' || new.workspace_id::text,
      0
    )
  );

  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception using
      errcode = '23514',
      message = 'an item cannot be its own parent';
  end if;

  if exists (
    with recursive ancestors (id, parent_id, path) as (
      select parent.id, parent.parent_id, array[parent.id]
      from public.documents as parent
      where parent.workspace_id = new.workspace_id
        and parent.id = new.parent_id

      union all

      select parent.id, parent.parent_id, ancestors.path || parent.id
      from public.documents as parent
      join ancestors on ancestors.parent_id = parent.id
      where parent.workspace_id = new.workspace_id
        and not parent.id = any (ancestors.path)
    )
    select 1
    from ancestors
    where ancestors.id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'moving this item would create a document tree cycle';
  end if;

  if exists (
    with recursive ancestors (id, parent_id, deletion_token, path) as (
      select parent.id, parent.parent_id, parent.deletion_token, array[parent.id]
      from public.documents as parent
      where parent.workspace_id = new.workspace_id
        and parent.id = new.parent_id

      union all

      select parent.id, parent.parent_id, parent.deletion_token, ancestors.path || parent.id
      from public.documents as parent
      join ancestors on ancestors.parent_id = parent.id
      where parent.workspace_id = new.workspace_id
        and not parent.id = any (ancestors.path)
    )
    select 1
    from ancestors
    where ancestors.deletion_token is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'the destination folder is pending permanent deletion';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_document_parent_cycle()
  from public, anon, authenticated;

create trigger documents_validate_parent_cycle
before insert or update of workspace_id, parent_id on public.documents
for each row execute function private.validate_document_parent_cycle();

-- Content-bearing APIs are restricted to real documents. Folder rows remain
-- visible through the documents SELECT policy but cannot receive Yjs updates,
-- versions, comments, Realtime document channels, or attachment objects.
create or replace function private.has_document_role(
  p_document_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_scenario_share_allowed_user()
    and exists (
      select 1
      from public.documents as document
      join public.workspace_members as member
        on member.workspace_id = document.workspace_id
      where document.id = p_document_id
        and document.item_type = 'document'
        and document.deletion_token is null
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
$$;

create or replace function private.can_access_document_topic(
  p_topic text,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_scenario_share_allowed_user()
    and exists (
      select 1
      from public.documents as document
      join public.workspace_members as member
        on member.workspace_id = document.workspace_id
      where p_topic = 'doc:' || document.id::text
        and document.item_type = 'document'
        and document.deletion_token is null
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
$$;

create or replace function private.can_access_attachment_object(
  p_object_name text,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_scenario_share_allowed_user()
    and exists (
      select 1
      from public.documents as document
      join public.workspace_members as member
        on member.workspace_id = document.workspace_id
      where split_part(p_object_name, '/', 1) = document.workspace_id::text
        and split_part(p_object_name, '/', 2) = document.id::text
        and split_part(p_object_name, '/', 3) <> ''
        and document.item_type = 'document'
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
$$;

-- Storage DELETE must remain available while a durable deletion is being
-- resumed, but uploads and overwrites are frozen with the document subtree.
create function private.can_write_attachment_object(
  p_object_name text,
  p_roles public.workspace_role[]
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select document.workspace_id
    into v_workspace_id
  from public.documents as document
  where split_part(p_object_name, '/', 1) = document.workspace_id::text
    and split_part(p_object_name, '/', 2) = document.id::text
    and split_part(p_object_name, '/', 3) <> '';

  if v_workspace_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'scenario-share-tree:' || v_workspace_id::text,
      0
    )
  );

  return private.is_scenario_share_allowed_user()
    and exists (
      select 1
      from public.documents as document
      join public.workspace_members as member
        on member.workspace_id = document.workspace_id
      where split_part(p_object_name, '/', 1) = document.workspace_id::text
        and split_part(p_object_name, '/', 2) = document.id::text
        and split_part(p_object_name, '/', 3) <> ''
        and document.item_type = 'document'
        and document.deletion_token is null
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
end;
$$;

revoke all on function private.can_write_attachment_object(text, public.workspace_role[])
  from public, anon, authenticated;
grant execute on function private.can_write_attachment_object(text, public.workspace_role[])
  to authenticated;

drop policy scenario_share_attachments_storage_insert on storage.objects;
create policy scenario_share_attachments_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'scenario-share-attachments'
  and private.can_write_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
);

drop policy scenario_share_attachments_storage_update on storage.objects;
create policy scenario_share_attachments_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'scenario-share-attachments'
  and private.can_write_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  bucket_id = 'scenario-share-attachments'
  and private.can_write_attachment_object(
    name,
    array['owner', 'editor']::public.workspace_role[]
  )
);

-- Return an exact server-side preview, including any legacy archived
-- descendants hidden from the normal sidebar query. Attachment paths are kept
-- in one jsonb value so PostgREST row limits cannot truncate a large preview.
create function public.preview_scenario_share_item_deletion(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select item.workspace_id
    into v_workspace_id
  from public.documents as item
  where item.id = p_item_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'document tree item not found';
  end if;

  if not private.has_workspace_role(
    v_workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  ) then
    raise exception using errcode = '42501', message = 'document delete preview permission denied';
  end if;

  return (
    with recursive subtree (id) as (
      select item.id
      from public.documents as item
      where item.workspace_id = v_workspace_id
        and item.id = p_item_id

      union

      select child.id
      from public.documents as child
      join subtree as parent on child.parent_id = parent.id
      where child.workspace_id = v_workspace_id
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', item.id,
              'title', item.title,
              'item_type', item.item_type,
              'archived', item.archived_at is not null,
              'deletion_pending', item.deletion_token is not null
            )
            order by item.created_at, item.id
          )
          from public.documents as item
          join subtree on subtree.id = item.id
        ),
        '[]'::jsonb
      ),
      'attachments', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', attachment.id,
              'object_path', attachment.object_path
            )
            order by attachment.created_at, attachment.id
          )
          from public.attachments as attachment
          where attachment.document_id in (select subtree.id from subtree)
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

comment on function public.preview_scenario_share_item_deletion(uuid) is
  'Returns the exact subtree and Storage objects that an editor must confirm and remove before permanent deletion.';

revoke all on function public.preview_scenario_share_item_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.preview_scenario_share_item_deletion(uuid)
  to authenticated;
grant execute on function public.preview_scenario_share_item_deletion(uuid)
  to service_role;

-- After the user confirms the preview, freeze the exact subtree and its
-- attachments under a durable token. If Storage cleanup is interrupted, the
-- same token remains available through this idempotent prepare call so the app
-- can safely retry instead of leaving an editable document with missing files.
create function public.prepare_scenario_share_item_deletion(
  p_item_id uuid,
  p_expected_item_ids uuid[],
  p_expected_attachment_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_item_ids uuid[];
  v_expected_item_ids uuid[];
  v_attachment_ids uuid[];
  v_expected_attachment_ids uuid[];
  v_attachments jsonb;
  v_deletion_token uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select item.workspace_id
    into v_workspace_id
  from public.documents as item
  where item.id = p_item_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'document tree item not found';
  end if;

  if not private.has_workspace_role(
    v_workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  ) then
    raise exception using errcode = '42501', message = 'document delete preparation permission denied';
  end if;

  if p_expected_item_ids is null
    or array_position(p_expected_item_ids, null) is not null
    or array_position(coalesce(p_expected_attachment_ids, '{}'::uuid[]), null) is not null
  then
    raise exception using errcode = '22004', message = 'deletion preview ids must not be null';
  end if;

  select coalesce(array_agg(expected_id order by expected_id), '{}'::uuid[])
    into v_expected_item_ids
  from unnest(p_expected_item_ids) as expected_id;

  select coalesce(array_agg(expected_id order by expected_id), '{}'::uuid[])
    into v_expected_attachment_ids
  from unnest(coalesce(p_expected_attachment_ids, '{}'::uuid[])) as expected_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'scenario-share-tree:' || v_workspace_id::text,
      0
    )
  );

  with recursive subtree (id) as (
    select item.id
    from public.documents as item
    where item.workspace_id = v_workspace_id
      and item.id = p_item_id

    union

    select child.id
    from public.documents as child
    join subtree as parent on child.parent_id = parent.id
    where child.workspace_id = v_workspace_id
  )
  select coalesce(array_agg(subtree.id order by subtree.id), '{}'::uuid[])
    into v_item_ids
  from subtree;

  perform item.id
  from public.documents as item
  where item.id = any (v_item_ids)
  for update;

  if v_item_ids is distinct from v_expected_item_ids then
    raise exception using
      errcode = '55000',
      message = 'document tree changed; preview the permanent deletion again';
  end if;

  perform attachment.id
  from public.attachments as attachment
  where attachment.document_id = any (v_item_ids)
  for update;

  select
    coalesce(array_agg(attachment.id order by attachment.id), '{}'::uuid[]),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'object_path', attachment.object_path
        )
        order by attachment.id
      ),
      '[]'::jsonb
    )
    into v_attachment_ids, v_attachments
  from public.attachments as attachment
  where attachment.document_id = any (v_item_ids);

  if v_attachment_ids is distinct from v_expected_attachment_ids then
    raise exception using
      errcode = '55000',
      message = 'attachments changed; preview the permanent deletion again';
  end if;

  select item.deletion_token
    into v_deletion_token
  from public.documents as item
  where item.id = p_item_id;

  if v_deletion_token is not null then
    if exists (
      select 1
      from public.documents as item
      where item.id = any (v_item_ids)
        and item.deletion_token is distinct from v_deletion_token
    ) then
      raise exception using
        errcode = '55000',
        message = 'document subtree has conflicting deletion intents';
    end if;

    select intent.attachments
      into v_attachments
    from private.document_deletion_intents as intent
    where intent.id = v_deletion_token
      and intent.workspace_id = v_workspace_id
      and intent.root_item_id = p_item_id
      and intent.item_ids = v_item_ids;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'deletion intent is incomplete; contact the workspace owner';
    end if;
  else
    if exists (
      select 1
      from public.documents as item
      where item.id = any (v_item_ids)
        and item.deletion_token is not null
    ) then
      raise exception using
        errcode = '55000',
        message = 'part of this subtree is already pending permanent deletion';
    end if;

    insert into private.document_deletion_intents (
      workspace_id,
      root_item_id,
      item_ids,
      attachments,
      created_by
    )
    values (
      v_workspace_id,
      p_item_id,
      v_item_ids,
      v_attachments,
      v_user_id
    )
    returning id into v_deletion_token;

    update public.documents as item
    set deletion_token = v_deletion_token
    where item.id = any (v_item_ids);
  end if;

  return jsonb_build_object(
    'deletion_token', v_deletion_token,
    'item_ids', to_jsonb(v_item_ids),
    'attachments', v_attachments
  );
end;
$$;

comment on function public.prepare_scenario_share_item_deletion(uuid, uuid[], uuid[]) is
  'Atomically freezes the exact confirmed subtree and attachments under a durable, retryable deletion token.';

revoke all on function public.prepare_scenario_share_item_deletion(uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.prepare_scenario_share_item_deletion(uuid, uuid[], uuid[])
  to authenticated;
grant execute on function public.prepare_scenario_share_item_deletion(uuid, uuid[], uuid[])
  to service_role;

-- Finalization is intentionally separate from Storage cleanup. A transient
-- client or database failure leaves the intent and frozen subtree intact, so
-- removing the same object paths and finalizing the same token is retryable.
create function public.delete_scenario_share_item(p_deletion_token uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_root_item_id uuid;
  v_item_ids uuid[];
  v_current_item_ids uuid[];
  v_expected_attachment_ids uuid[];
  v_current_attachment_ids uuid[];
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select intent.workspace_id, intent.root_item_id, intent.item_ids
    into v_workspace_id, v_root_item_id, v_item_ids
  from private.document_deletion_intents as intent
  where intent.id = p_deletion_token;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'deletion intent not found';
  end if;

  if not private.has_workspace_role(
    v_workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  ) then
    raise exception using errcode = '42501', message = 'document delete permission denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'scenario-share-tree:' || v_workspace_id::text,
      0
    )
  );

  perform intent.id
  from private.document_deletion_intents as intent
  where intent.id = p_deletion_token
  for update;

  with recursive subtree (id) as (
    select item.id
    from public.documents as item
    where item.workspace_id = v_workspace_id
      and item.id = v_root_item_id

    union

    select child.id
    from public.documents as child
    join subtree as parent on child.parent_id = parent.id
    where child.workspace_id = v_workspace_id
  )
  select coalesce(array_agg(subtree.id order by subtree.id), '{}'::uuid[])
    into v_current_item_ids
  from subtree;

  perform item.id
  from public.documents as item
  where item.id = any (v_item_ids)
  for update;

  if v_current_item_ids is distinct from v_item_ids
    or exists (
      select 1
      from public.documents as item
      where item.id = any (v_item_ids)
        and item.deletion_token is distinct from p_deletion_token
    )
  then
    raise exception using
      errcode = '55000',
      message = 'frozen document subtree changed; permanent deletion was not finalized';
  end if;

  perform attachment.id
  from public.attachments as attachment
  where attachment.document_id = any (v_item_ids)
  for update;

  select coalesce(array_agg((entry ->> 'id')::uuid order by (entry ->> 'id')::uuid), '{}'::uuid[])
    into v_expected_attachment_ids
  from private.document_deletion_intents as intent
  cross join lateral jsonb_array_elements(intent.attachments) as entry
  where intent.id = p_deletion_token;

  select coalesce(array_agg(attachment.id order by attachment.id), '{}'::uuid[])
    into v_current_attachment_ids
  from public.attachments as attachment
  where attachment.document_id = any (v_item_ids);

  if v_current_attachment_ids is distinct from v_expected_attachment_ids then
    raise exception using
      errcode = '55000',
      message = 'frozen attachments changed; permanent deletion was not finalized';
  end if;

  perform set_config(
    'scenario_share.deletion_token',
    p_deletion_token::text,
    true
  );

  delete from public.attachments as attachment
  where attachment.id = any (v_expected_attachment_ids);

  delete from public.documents as item
  where item.workspace_id = v_workspace_id
    and item.id = v_root_item_id;

  delete from private.document_deletion_intents as intent
  where intent.id = p_deletion_token;

  return v_item_ids;
end;
$$;

comment on function public.delete_scenario_share_item(uuid) is
  'Finalizes a durable deletion intent after its Storage objects have been removed; safe to retry until successful.';

revoke all on function public.delete_scenario_share_item(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_scenario_share_item(uuid)
  to authenticated;
grant execute on function public.delete_scenario_share_item(uuid)
  to service_role;

-- The app sends item_type only while creating a folder. Existing clients that
-- omit the column continue to create documents through the column default.
grant insert (item_type) on table public.documents to authenticated;

-- Direct document writes are blocked once a durable deletion starts. The
-- security-definer prepare/finalize functions are the only writers allowed to
-- set or clear the private deletion token.
drop policy documents_update_editors on public.documents;
create policy documents_update_editors
on public.documents
for update
to authenticated
using (
  deletion_token is null
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  deletion_token is null
  and updated_by = (select auth.uid())
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

-- Archiving is no longer part of the product UI. Keep the columns for backwards
-- compatibility but prevent clients from creating new hidden rows.
revoke update (archived_at) on table public.documents from authenticated;
