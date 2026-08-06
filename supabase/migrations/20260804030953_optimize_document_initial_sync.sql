-- Serve one authorization-checked initial sync payload and compact only the
-- exact Yjs updates that a client proves it has folded into a canonical state.
-- User-visible document_versions remain independent history entries.

create table private.document_sync_snapshots (
  document_id uuid primary key
    references public.documents (id) on delete cascade,
  yjs_state text not null
    check (
      char_length(yjs_state) > 0
      and char_length(yjs_state) % 4 = 0
      and yjs_state ~ '^[A-Za-z0-9+/]+={0,2}$'
    ),
  generation bigint not null check (generation > 0),
  compacted_update_count integer not null default 0
    check (compacted_update_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
    references public.profiles (id) on delete restrict
);

comment on table private.document_sync_snapshots is
  'Internal canonical Yjs states used for fast document startup. User-visible history stays in document_versions.';
comment on column private.document_sync_snapshots.generation is
  'Optimistic concurrency token. Every successful compaction increments it.';

alter table private.document_sync_snapshots enable row level security;
revoke all on table private.document_sync_snapshots
  from public, anon, authenticated;
grant all on table private.document_sync_snapshots to service_role;

create function private.load_document_sync_internal(p_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot_state text;
  v_snapshot_generation bigint := 0;
  v_source_version_id bigint;
  v_updates jsonb := '[]'::jsonb;
  v_checkpoint_id bigint;
begin
  if v_user_id is null
     or not private.has_document_role(
       p_document_id,
       array['owner', 'editor', 'viewer']::public.workspace_role[]
     ) then
    raise exception using
      errcode = '42501',
      message = 'Document access denied';
  end if;

  select snapshot.yjs_state, snapshot.generation
  into v_snapshot_state, v_snapshot_generation
  from private.document_sync_snapshots as snapshot
  where snapshot.document_id = p_document_id;

  if not found then
    v_snapshot_generation := 0;
    select version.yjs_state, version.id
    into v_snapshot_state, v_source_version_id
    from public.document_versions as version
    where version.document_id = p_document_id
    order by version.id desc
    limit 1;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', update_row.id,
          'yjs_update', update_row.yjs_update
        )
        order by update_row.id
      ),
      '[]'::jsonb
    ),
    max(update_row.id)
  into v_updates, v_checkpoint_id
  from public.document_updates as update_row
  where update_row.document_id = p_document_id;

  return jsonb_build_object(
    'snapshot_state', v_snapshot_state,
    'snapshot_generation', v_snapshot_generation,
    'source_version_id', v_source_version_id,
    'checkpoint_id', v_checkpoint_id,
    'updates', v_updates
  );
end;
$$;

create function private.compact_document_sync_internal(
  p_document_id uuid,
  p_expected_generation bigint,
  p_yjs_state text,
  p_update_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_generation bigint;
  v_next_generation bigint;
  v_requested_count integer;
  v_matched_count integer;
  v_deleted_count integer;
begin
  if v_user_id is null
     or not private.has_document_role(
       p_document_id,
       array['owner', 'editor']::public.workspace_role[]
     ) then
    raise exception using
      errcode = '42501',
      message = 'Document edit access denied';
  end if;

  if p_expected_generation is null or p_expected_generation < 0 then
    raise exception using
      errcode = '22023',
      message = 'Expected snapshot generation must be zero or greater';
  end if;

  if p_yjs_state is null
     or char_length(p_yjs_state) = 0
     or char_length(p_yjs_state) > 33554432
     or char_length(p_yjs_state) % 4 <> 0
     or p_yjs_state !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception using
      errcode = '22023',
      message = 'Invalid Yjs snapshot state';
  end if;

  v_requested_count := coalesce(cardinality(p_update_ids), 0);
  if v_requested_count = 0 or v_requested_count > 20000 then
    raise exception using
      errcode = '22023',
      message = 'Compaction requires between 1 and 20000 update ids';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'scenario-share-sync-snapshot:' || p_document_id::text,
      0
    )
  );

  select coalesce(snapshot.generation, 0)
  into v_current_generation
  from (select 1) as singleton
  left join private.document_sync_snapshots as snapshot
    on snapshot.document_id = p_document_id;

  if v_current_generation <> p_expected_generation then
    return jsonb_build_object(
      'status', 'stale',
      'snapshot_generation', v_current_generation,
      'compacted_count', 0
    );
  end if;

  select count(*)::integer
  into v_matched_count
  from public.document_updates as update_row
  where update_row.document_id = p_document_id
    and update_row.id = any (p_update_ids);

  if v_matched_count <> v_requested_count then
    return jsonb_build_object(
      'status', 'updates_changed',
      'snapshot_generation', v_current_generation,
      'compacted_count', 0
    );
  end if;

  v_next_generation := v_current_generation + 1;

  insert into private.document_sync_snapshots as snapshot (
    document_id,
    yjs_state,
    generation,
    compacted_update_count,
    updated_by
  )
  values (
    p_document_id,
    p_yjs_state,
    v_next_generation,
    v_matched_count,
    v_user_id
  )
  on conflict (document_id) do update
  set yjs_state = excluded.yjs_state,
      generation = excluded.generation,
      compacted_update_count = excluded.compacted_update_count,
      updated_at = now(),
      updated_by = excluded.updated_by;

  delete from public.document_updates as update_row
  where update_row.document_id = p_document_id
    and update_row.id = any (p_update_ids);
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> v_requested_count then
    raise exception using
      errcode = '40001',
      message = 'Document updates changed during compaction';
  end if;

  return jsonb_build_object(
    'status', 'compacted',
    'snapshot_generation', v_next_generation,
    'compacted_count', v_deleted_count
  );
end;
$$;

create function public.load_document_sync(p_document_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.load_document_sync_internal(p_document_id);
$$;

create function public.compact_document_sync(
  p_document_id uuid,
  p_expected_generation bigint,
  p_yjs_state text,
  p_update_ids bigint[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.compact_document_sync_internal(
    p_document_id,
    p_expected_generation,
    p_yjs_state,
    p_update_ids
  );
$$;

revoke all on function private.load_document_sync_internal(uuid)
  from public, anon, authenticated;
revoke all on function private.compact_document_sync_internal(uuid, bigint, text, bigint[])
  from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.load_document_sync_internal(uuid)
  to authenticated, service_role;
grant execute on function private.compact_document_sync_internal(uuid, bigint, text, bigint[])
  to authenticated, service_role;

revoke all on function public.load_document_sync(uuid)
  from public, anon;
revoke all on function public.compact_document_sync(uuid, bigint, text, bigint[])
  from public, anon;
grant execute on function public.load_document_sync(uuid)
  to authenticated, service_role;
grant execute on function public.compact_document_sync(uuid, bigint, text, bigint[])
  to authenticated, service_role;

comment on function public.load_document_sync(uuid) is
  'Returns one access-checked initial Yjs snapshot-and-tail payload.';
comment on function public.compact_document_sync(uuid, bigint, text, bigint[]) is
  'Atomically replaces the internal sync snapshot and removes only explicitly incorporated update rows.';
