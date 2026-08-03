-- Harden ScenarioShare bootstrap ownership and make Yjs checkpoint recovery
-- safe under concurrent PostgreSQL transactions.

create or replace function private.maintain_document_versions()
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

  -- Keep the append-only update log. Identity values are allocated before a
  -- transaction commits, so `id <= last_update_id` is not proof that every
  -- lower-id update was visible to the snapshot transaction. Yjs replays the
  -- complete log idempotently to avoid losing a late-committing update.
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

comment on column public.document_versions.last_update_id is
  'Highest update id observed while saving. Diagnostic only; never use as a replay cutoff because identity order is not commit order.';

create or replace function public.claim_scenario_share_workspace()
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
    if split_part(v_email, '@', 2) <> 'metarmo.com' then
      raise exception using
        errcode = '42501',
        message = 'the initial ScenarioShare owner must use a verified @metarmo.com Google account';
    end if;

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

revoke all on function public.claim_scenario_share_workspace()
  from public, anon;
grant execute on function public.claim_scenario_share_workspace()
  to authenticated;
