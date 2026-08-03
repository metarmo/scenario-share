-- Remove the former organization-domain bootstrap rule without allowing an
-- arbitrary Google user to claim the empty workspace. A trusted Supabase
-- administrator must seed one pending owner invitation for the initial user.

alter table public.workspace_invites
  drop constraint workspace_invites_role_check;

comment on column public.workspace_invites.role is
  'Owner is reserved for the one-time administrator-seeded bootstrap invite; app users may invite only editor or viewer roles.';

drop policy workspace_invites_insert_editors on public.workspace_invites;
create policy workspace_invites_insert_editors
on public.workspace_invites
for insert
to authenticated
with check (
  role <> 'owner'
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
  v_invite_id uuid;
  v_bootstrap_required boolean;
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

  select not exists (
    select 1
    from public.workspace_members as existing_member
    where existing_member.workspace_id = v_workspace_id
  ) into v_bootstrap_required;

  select invitation.id, invitation.role
    into v_invite_id, v_role
  from public.workspace_invites as invitation
  where invitation.workspace_id = v_workspace_id
    and invitation.email = v_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > now()
    and (
      (v_bootstrap_required and invitation.role = 'owner')
      or (not v_bootstrap_required and invitation.role <> 'owner')
    )
  order by invitation.created_at
  limit 1
  for update;

  if v_invite_id is null then
    raise exception using
      errcode = '42501',
      message = case
        when v_bootstrap_required then
          'an administrator-issued initial owner invitation is required'
        else
          'no active ScenarioShare invitation matches this Google email'
      end;
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
