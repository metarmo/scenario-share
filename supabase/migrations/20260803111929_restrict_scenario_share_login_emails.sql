-- ScenarioShare is a two-account private workspace. Auth hooks prevent any
-- other account from being created or receiving an access token, while the
-- RLS helpers and claim RPC enforce the same boundary in Postgres.

create or replace function public.hook_restrict_scenario_share_user(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(event -> 'user' ->> 'email'));
  v_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
begin
  if v_provider = 'google'
     and v_email = any (array[
       'kevin34320710@gmail.com',
       'nekoya404@gmail.com'
     ]::text[]) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This Google account is not allowed to use ScenarioShare.'
    )
  );
end;
$$;

comment on function public.hook_restrict_scenario_share_user(jsonb) is
  'Before-user-created Auth hook allowing only the two approved Google accounts.';

create or replace function public.hook_restrict_scenario_share_access_token(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(event -> 'claims' ->> 'email'));
begin
  if v_email = any (array[
    'kevin34320710@gmail.com',
    'nekoya404@gmail.com'
  ]::text[]) then
    return event;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This account is not allowed to use ScenarioShare.'
    )
  );
end;
$$;

comment on function public.hook_restrict_scenario_share_access_token(jsonb) is
  'Custom-access-token Auth hook allowing token issuance only for the two approved emails.';

grant usage on schema public to supabase_auth_admin;

revoke execute on function public.hook_restrict_scenario_share_user(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_restrict_scenario_share_user(jsonb)
  to supabase_auth_admin;

revoke execute on function public.hook_restrict_scenario_share_access_token(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_restrict_scenario_share_access_token(jsonb)
  to supabase_auth_admin;

create or replace function private.is_scenario_share_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = (select auth.uid())
      and auth_user.email_confirmed_at is not null
      and lower(btrim(auth_user.email)) = any (array[
        'kevin34320710@gmail.com',
        'nekoya404@gmail.com'
      ]::text[])
      and exists (
        select 1
        from auth.identities as identity
        where identity.user_id = auth_user.id
          and identity.provider = 'google'
      )
  );
$$;

comment on function private.is_scenario_share_allowed_user() is
  'Authoritative verified-Google-email allowlist check used by ScenarioShare RLS helpers.';

revoke all on function private.is_scenario_share_allowed_user()
  from public, anon, authenticated;

create or replace function private.has_workspace_role(
  p_workspace_id uuid,
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
      from public.workspace_members as member
      where member.workspace_id = p_workspace_id
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
$$;

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
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
$$;

create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_scenario_share_allowed_user()
    and (
      (select auth.uid()) = p_profile_id
      or exists (
        select 1
        from public.workspace_members as own_membership
        join public.workspace_members as other_membership
          on other_membership.workspace_id = own_membership.workspace_id
        where own_membership.user_id = (select auth.uid())
          and other_membership.user_id = p_profile_id
      )
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
        and member.user_id = (select auth.uid())
        and member.role = any (p_roles)
    );
$$;

drop policy workspace_invites_insert_editors on public.workspace_invites;
create policy workspace_invites_insert_editors
on public.workspace_invites
for insert
to authenticated
with check (
  role <> 'owner'
  and lower(btrim(email)) = any (array[
    'kevin34320710@gmail.com',
    'nekoya404@gmail.com'
  ]::text[])
  and invited_by = (select auth.uid())
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

drop policy workspace_invites_update_editors on public.workspace_invites;
create policy workspace_invites_update_editors
on public.workspace_invites
for update
to authenticated
using (
  role <> 'owner'
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
)
with check (
  role <> 'owner'
  and lower(btrim(email)) = any (array[
    'kevin34320710@gmail.com',
    'nekoya404@gmail.com'
  ]::text[])
  and private.has_workspace_role(
    workspace_id,
    array['owner', 'editor']::public.workspace_role[]
  )
);

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

  if v_email <> all (array[
    'kevin34320710@gmail.com',
    'nekoya404@gmail.com'
  ]::text[]) then
    raise exception using
      errcode = '42501',
      message = 'this Google account is not allowed to use ScenarioShare';
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

  v_role := case v_email
    when 'kevin34320710@gmail.com' then 'owner'::public.workspace_role
    else 'editor'::public.workspace_role
  end;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, v_role);

  return query select v_workspace_id, v_user_id, v_role;
end;
$$;

comment on function public.claim_scenario_share_workspace() is
  'Automatically provisions only the two approved verified Google accounts.';

revoke all on function public.claim_scenario_share_workspace()
  from public, anon;
grant execute on function public.claim_scenario_share_workspace()
  to authenticated;
