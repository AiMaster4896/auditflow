-- AuditFlow schema.sql
-- Consolidated, reproducible record of every migration applied to the live
-- Supabase project (ref qfxwgyeuqkqziemxrfyf, "AuditFlow") via Anthropic's
-- Supabase MCP connector on 2026-07-11. Run top to bottom against a fresh
-- Supabase project to rebuild the schema from scratch.

-- ============================================================
-- 001_core_identity
-- ============================================================
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisation_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  logo_url text,
  primary_colour text default '#1d4ed8',
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  designation text,
  status text not null default 'active',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('firm_admin','staff')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index idx_org_members_org on public.organisation_members(organisation_id);
create index idx_org_members_user on public.organisation_members(user_id);

create trigger trg_org_updated before update on public.organisations for each row execute function public.set_updated_at();
create trigger trg_org_settings_updated before update on public.organisation_settings for each row execute function public.set_updated_at();
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_org_members_updated before update on public.organisation_members for each row execute function public.set_updated_at();

-- ============================================================
-- 002_clients_and_aliases
-- ============================================================
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  legal_name text not null,
  registration_number text,
  financial_year_end date,
  audit_fee numeric(14,2),
  status text not null default 'active',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_clients_org on public.clients(organisation_id);
create index idx_clients_name on public.clients(organisation_id, legal_name);

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text,
  email text,
  phone text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_client_contacts_client on public.client_contacts(client_id);

create table public.client_service_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  assigned_user_id uuid references public.profiles(id),
  assigned_name_raw text,
  assignment_role text not null,
  service_type text not null default 'audit',
  mapping_status text not null default 'unresolved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_csa_client on public.client_service_assignments(client_id);
create index idx_csa_org on public.client_service_assignments(organisation_id);

create table public.staff_aliases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  alias text not null,
  user_id uuid references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, alias)
);

create table public.client_aliases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  alias text not null,
  client_id uuid references public.clients(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, alias)
);

create trigger trg_clients_updated before update on public.clients for each row execute function public.set_updated_at();
create trigger trg_client_contacts_updated before update on public.client_contacts for each row execute function public.set_updated_at();
create trigger trg_csa_updated before update on public.client_service_assignments for each row execute function public.set_updated_at();
create trigger trg_staff_aliases_updated before update on public.staff_aliases for each row execute function public.set_updated_at();
create trigger trg_client_aliases_updated before update on public.client_aliases for each row execute function public.set_updated_at();

-- ============================================================
-- 003_deadlines_and_planning
-- ============================================================
create table public.deadline_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  deadline_type text not null,
  offset_months int not null default 0,
  offset_days int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_deadlines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  deadline_type text not null,
  deadline_date date not null,
  financial_year_end date,
  source text not null default 'calculated_rule' check (source in ('imported_excel','calculated_rule','manual')),
  source_sheet text,
  source_row int,
  status text not null default 'not_due' check (status in ('not_due','due_soon','overdue','completed','not_applicable')),
  completed_date date,
  manual_override boolean not null default false,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_deadlines_client on public.client_deadlines(client_id);
create index idx_deadlines_org on public.client_deadlines(organisation_id);
create index idx_deadlines_status on public.client_deadlines(organisation_id, status);
create unique index uq_deadline_import_key on public.client_deadlines(organisation_id, client_id, deadline_type, deadline_date, source_sheet) where source = 'imported_excel';

create table public.deadline_assignees (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  deadline_id uuid not null references public.client_deadlines(id) on delete cascade,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_deadline_assignees_deadline on public.deadline_assignees(deadline_id);

create trigger trg_deadline_rules_updated before update on public.deadline_rules for each row execute function public.set_updated_at();
create trigger trg_client_deadlines_updated before update on public.client_deadlines for each row execute function public.set_updated_at();

-- ============================================================
-- 004_work_orders_resources_ai
-- ============================================================
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid references public.clients(id),
  requested_by uuid not null references public.profiles(id),
  order_type text not null check (order_type in ('client_create','client_update','client_deactivate','invoice_request','generic_request')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_wo_org on public.work_orders(organisation_id);
create index idx_wo_status on public.work_orders(organisation_id, status);

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  action text not null check (action in ('approved','rejected')),
  reviewed_by uuid not null references public.profiles(id),
  remarks text,
  created_at timestamptz not null default now()
);
create index idx_approval_wo on public.approval_actions(work_order_id);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_resources_org on public.resources(organisation_id);

create table public.ai_tools (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  url text not null,
  description text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ai_tools_org on public.ai_tools(organisation_id);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_activity_org on public.activity_logs(organisation_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, is_read);

create trigger trg_wo_updated before update on public.work_orders for each row execute function public.set_updated_at();
create trigger trg_resources_updated before update on public.resources for each row execute function public.set_updated_at();
create trigger trg_ai_tools_updated before update on public.ai_tools for each row execute function public.set_updated_at();

-- ============================================================
-- 005_workspace_chat_import
-- ============================================================
create table public.workspace_user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  base_style text default 'masculine' check (base_style in ('masculine','feminine')),
  skin_tone text default 'medium',
  hairstyle text default 'short',
  hair_color text default 'black',
  shirt_color text default 'white',
  has_glasses boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  room_type text not null default 'public' check (room_type in ('public','private')),
  name text,
  created_at timestamptz not null default now()
);
create index idx_chat_rooms_org on public.chat_rooms(organisation_id);

create table public.chat_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_room on public.chat_messages(room_id, created_at);

create table public.chat_read_receipts (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  filename text not null,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','dry_run','completed','failed')),
  valid_count int not null default 0,
  warning_count int not null default 0,
  rejected_count int not null default 0,
  notes text
);
create index idx_import_batches_org on public.import_batches(organisation_id);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row int not null,
  raw_payload jsonb not null,
  normalized_payload jsonb,
  validation_status text not null default 'pending' check (validation_status in ('pending','valid','warning','rejected','duplicate')),
  validation_messages text,
  imported_entity_type text,
  imported_entity_id uuid
);
create index idx_import_rows_batch on public.import_rows(import_batch_id);

create trigger trg_workspace_settings_updated before update on public.workspace_user_settings for each row execute function public.set_updated_at();

alter table public.client_deadlines add constraint fk_deadlines_import_batch foreign key (import_batch_id) references public.import_batches(id);

-- ============================================================
-- 006_security_functions
-- ============================================================
create or replace function public.current_organisation_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organisation_id
  from organisation_members
  where user_id = auth.uid()
    and status = 'active';
$$;

create or replace function public.is_firm_admin(org_uuid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = org_uuid
      and user_id = auth.uid()
      and role = 'firm_admin'
      and status = 'active'
  );
$$;

grant execute on function public.current_organisation_ids() to authenticated;
grant execute on function public.is_firm_admin(uuid) to authenticated;

-- ============================================================
-- 007_rls_core
-- ============================================================
alter table public.organisations enable row level security;
alter table public.organisation_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.organisation_members enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_service_assignments enable row level security;
alter table public.staff_aliases enable row level security;
alter table public.client_aliases enable row level security;

create policy org_select on public.organisations for select
  using (id in (select current_organisation_ids()));
create policy org_update_admin on public.organisations for update
  using (is_firm_admin(id));

create policy org_settings_select on public.organisation_settings for select
  using (organisation_id in (select current_organisation_ids()));
create policy org_settings_update_admin on public.organisation_settings for update
  using (is_firm_admin(organisation_id));
create policy org_settings_insert_admin on public.organisation_settings for insert
  with check (is_firm_admin(organisation_id));

create policy profiles_select_self on public.profiles for select
  using (id = auth.uid());
create policy profiles_select_org_peers on public.profiles for select
  using (id in (
    select om.user_id from organisation_members om
    where om.organisation_id in (select current_organisation_ids())
  ));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid());

create policy org_members_select on public.organisation_members for select
  using (organisation_id in (select current_organisation_ids()));
create policy org_members_write_admin on public.organisation_members for insert
  with check (is_firm_admin(organisation_id));
create policy org_members_update_admin on public.organisation_members for update
  using (is_firm_admin(organisation_id));
create policy org_members_delete_admin on public.organisation_members for delete
  using (is_firm_admin(organisation_id));

create policy clients_select on public.clients for select
  using (organisation_id in (select current_organisation_ids()));
create policy clients_write_admin on public.clients for insert
  with check (is_firm_admin(organisation_id));
create policy clients_update_admin on public.clients for update
  using (is_firm_admin(organisation_id));
create policy clients_delete_admin on public.clients for delete
  using (is_firm_admin(organisation_id));

create policy client_contacts_select on public.client_contacts for select
  using (organisation_id in (select current_organisation_ids()));
create policy client_contacts_write_admin on public.client_contacts for insert
  with check (is_firm_admin(organisation_id));
create policy client_contacts_update_admin on public.client_contacts for update
  using (is_firm_admin(organisation_id));
create policy client_contacts_delete_admin on public.client_contacts for delete
  using (is_firm_admin(organisation_id));

create policy csa_select on public.client_service_assignments for select
  using (organisation_id in (select current_organisation_ids()));
create policy csa_write_admin on public.client_service_assignments for insert
  with check (is_firm_admin(organisation_id));
create policy csa_update_admin on public.client_service_assignments for update
  using (is_firm_admin(organisation_id));
create policy csa_delete_admin on public.client_service_assignments for delete
  using (is_firm_admin(organisation_id));

create policy staff_aliases_select on public.staff_aliases for select
  using (organisation_id in (select current_organisation_ids()));
create policy staff_aliases_write_admin on public.staff_aliases for insert
  with check (is_firm_admin(organisation_id));
create policy staff_aliases_update_admin on public.staff_aliases for update
  using (is_firm_admin(organisation_id));

create policy client_aliases_select on public.client_aliases for select
  using (organisation_id in (select current_organisation_ids()));
create policy client_aliases_write_admin on public.client_aliases for insert
  with check (is_firm_admin(organisation_id));
create policy client_aliases_update_admin on public.client_aliases for update
  using (is_firm_admin(organisation_id));

-- ============================================================
-- 008_rls_deadlines_planning
-- ============================================================
alter table public.deadline_rules enable row level security;
alter table public.client_deadlines enable row level security;
alter table public.deadline_assignees enable row level security;

create policy deadline_rules_select on public.deadline_rules for select
  using (organisation_id in (select current_organisation_ids()));
create policy deadline_rules_write_admin on public.deadline_rules for insert
  with check (is_firm_admin(organisation_id));
create policy deadline_rules_update_admin on public.deadline_rules for update
  using (is_firm_admin(organisation_id));

create policy client_deadlines_select on public.client_deadlines for select
  using (organisation_id in (select current_organisation_ids()));
create policy client_deadlines_write_admin on public.client_deadlines for insert
  with check (is_firm_admin(organisation_id));
create policy client_deadlines_update_admin on public.client_deadlines for update
  using (is_firm_admin(organisation_id));
create policy client_deadlines_delete_admin on public.client_deadlines for delete
  using (is_firm_admin(organisation_id));

create policy deadline_assignees_select on public.deadline_assignees for select
  using (organisation_id in (select current_organisation_ids()));
create policy deadline_assignees_write_admin on public.deadline_assignees for insert
  with check (is_firm_admin(organisation_id));
create policy deadline_assignees_delete_admin on public.deadline_assignees for delete
  using (is_firm_admin(organisation_id));

-- ============================================================
-- 009_rls_workorders_resources
-- ============================================================
alter table public.work_orders enable row level security;
alter table public.approval_actions enable row level security;
alter table public.resources enable row level security;
alter table public.ai_tools enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;

create policy wo_select on public.work_orders for select
  using (organisation_id in (select current_organisation_ids()));
create policy wo_insert_member on public.work_orders for insert
  with check (organisation_id in (select current_organisation_ids()) and requested_by = auth.uid());
create policy wo_update_admin on public.work_orders for update
  using (is_firm_admin(organisation_id));

create policy approval_select on public.approval_actions for select
  using (organisation_id in (select current_organisation_ids()));
create policy approval_insert_admin on public.approval_actions for insert
  with check (is_firm_admin(organisation_id));

create policy resources_select on public.resources for select
  using (organisation_id in (select current_organisation_ids()));
create policy resources_insert_member on public.resources for insert
  with check (organisation_id in (select current_organisation_ids()));
create policy resources_delete_admin on public.resources for delete
  using (is_firm_admin(organisation_id));

create policy ai_tools_select on public.ai_tools for select
  using (organisation_id in (select current_organisation_ids()));
create policy ai_tools_write_admin on public.ai_tools for insert
  with check (is_firm_admin(organisation_id));
create policy ai_tools_update_admin on public.ai_tools for update
  using (is_firm_admin(organisation_id));

create policy activity_select on public.activity_logs for select
  using (organisation_id in (select current_organisation_ids()));
create policy activity_insert_member on public.activity_logs for insert
  with check (organisation_id in (select current_organisation_ids()));

create policy notifications_select_own on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update
  using (user_id = auth.uid());
create policy notifications_insert_admin on public.notifications for insert
  with check (is_firm_admin(organisation_id));

-- ============================================================
-- 010_rls_workspace_chat_import
-- ============================================================
alter table public.workspace_user_settings enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_read_receipts enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

create policy workspace_settings_select on public.workspace_user_settings for select
  using (organisation_id in (select current_organisation_ids()));
create policy workspace_settings_upsert_own on public.workspace_user_settings for insert
  with check (user_id = auth.uid());
create policy workspace_settings_update_own on public.workspace_user_settings for update
  using (user_id = auth.uid());

create policy chat_rooms_select on public.chat_rooms for select
  using (
    organisation_id in (select current_organisation_ids())
    and (
      room_type = 'public'
      or id in (select room_id from chat_room_members where user_id = auth.uid())
    )
  );
create policy chat_rooms_insert_member on public.chat_rooms for insert
  with check (organisation_id in (select current_organisation_ids()));

create policy chat_room_members_select on public.chat_room_members for select
  using (
    user_id = auth.uid()
    or room_id in (select room_id from chat_room_members crm where crm.user_id = auth.uid())
  );
create policy chat_room_members_insert_self on public.chat_room_members for insert
  with check (user_id = auth.uid());

create policy chat_messages_select on public.chat_messages for select
  using (room_id in (select room_id from chat_room_members where user_id = auth.uid()));
create policy chat_messages_insert_member on public.chat_messages for insert
  with check (
    sender_id = auth.uid()
    and room_id in (select room_id from chat_room_members where user_id = auth.uid())
  );

create policy chat_read_receipts_select_own on public.chat_read_receipts for select
  using (user_id = auth.uid());
create policy chat_read_receipts_upsert_own on public.chat_read_receipts for insert
  with check (user_id = auth.uid());
create policy chat_read_receipts_update_own on public.chat_read_receipts for update
  using (user_id = auth.uid());

create policy import_batches_select_admin on public.import_batches for select
  using (is_firm_admin(organisation_id));
create policy import_batches_insert_admin on public.import_batches for insert
  with check (is_firm_admin(organisation_id));
create policy import_batches_update_admin on public.import_batches for update
  using (is_firm_admin(organisation_id));

create policy import_rows_select_admin on public.import_rows for select
  using (import_batch_id in (select id from import_batches where is_firm_admin(organisation_id)));
create policy import_rows_insert_admin on public.import_rows for insert
  with check (import_batch_id in (select id from import_batches where is_firm_admin(organisation_id)));
create policy import_rows_update_admin on public.import_rows for update
  using (import_batch_id in (select id from import_batches where is_firm_admin(organisation_id)));

-- ============================================================
-- 011_rpc_functions
-- ============================================================
create or replace function public.generate_client_deadlines(client_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_fye date;
  r record;
  v_date date;
begin
  select organisation_id, financial_year_end into v_org, v_fye
  from clients where id = client_uuid;

  if v_org is null then
    raise exception 'Client not found';
  end if;

  if not is_firm_admin(v_org) then
    raise exception 'Not authorized';
  end if;

  if v_fye is null then
    return;
  end if;

  for r in
    select deadline_type, offset_months, offset_days
    from deadline_rules
    where active
      and (organisation_id = v_org or organisation_id is null)
  loop
    if exists (
      select 1 from client_deadlines
      where client_id = client_uuid
        and deadline_type = r.deadline_type
        and source in ('imported_excel','manual')
    ) then
      continue;
    end if;

    v_date := (v_fye + (r.offset_months || ' months')::interval + (r.offset_days || ' days')::interval)::date;

    insert into client_deadlines (organisation_id, client_id, deadline_type, deadline_date, financial_year_end, source, status)
    values (v_org, client_uuid, r.deadline_type, v_date, v_fye, 'calculated_rule', 'not_due')
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.approve_work_order(work_order_uuid uuid, review_remarks text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
begin
  select organisation_id, status into v_org, v_status from work_orders where id = work_order_uuid;
  if v_org is null then
    raise exception 'Work order not found';
  end if;
  if not is_firm_admin(v_org) then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'Work order already actioned';
  end if;

  update work_orders set status = 'approved' where id = work_order_uuid;
  insert into approval_actions (organisation_id, work_order_id, action, reviewed_by, remarks)
  values (v_org, work_order_uuid, 'approved', auth.uid(), review_remarks);
end;
$$;

create or replace function public.reject_work_order(work_order_uuid uuid, review_remarks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
begin
  if review_remarks is null or length(trim(review_remarks)) = 0 then
    raise exception 'Remarks are required to reject a work order';
  end if;

  select organisation_id, status into v_org, v_status from work_orders where id = work_order_uuid;
  if v_org is null then
    raise exception 'Work order not found';
  end if;
  if not is_firm_admin(v_org) then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'Work order already actioned';
  end if;

  update work_orders set status = 'rejected' where id = work_order_uuid;
  insert into approval_actions (organisation_id, work_order_id, action, reviewed_by, remarks)
  values (v_org, work_order_uuid, 'rejected', auth.uid(), review_remarks);
end;
$$;

create or replace function public.mark_deadline_completed(deadline_uuid uuid, completed_date date, remarks text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from client_deadlines where id = deadline_uuid;
  if v_org is null then
    raise exception 'Deadline not found';
  end if;
  if v_org not in (select current_organisation_ids()) then
    raise exception 'Not authorized';
  end if;

  update client_deadlines
  set status = 'completed', completed_date = mark_deadline_completed.completed_date
  where id = deadline_uuid;

  if remarks is not null then
    insert into activity_logs (organisation_id, user_id, action, entity_type, entity_id, detail)
    values (v_org, auth.uid(), 'deadline_completed', 'client_deadlines', deadline_uuid, jsonb_build_object('remarks', remarks));
  end if;
end;
$$;

-- ============================================================
-- 012_import_rpc_functions
-- ============================================================
create or replace function public.import_completed_rows(import_batch_uuid uuid, rows_jsonb jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row jsonb;
  v_client_id uuid;
  v_deadline jsonb;
  v_inserted int := 0;
  v_skipped int := 0;
begin
  select organisation_id into v_org from import_batches where id = import_batch_uuid;
  if v_org is null then
    raise exception 'Import batch not found';
  end if;
  if not is_firm_admin(v_org) then
    raise exception 'Not authorized';
  end if;

  for v_row in select * from jsonb_array_elements(rows_jsonb)
  loop
    if coalesce(trim(v_row->>'company_name'), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into v_client_id
    from clients
    where organisation_id = v_org
      and lower(trim(legal_name)) = lower(trim(v_row->>'company_name'));

    if v_client_id is null then
      insert into clients (organisation_id, legal_name, registration_number, financial_year_end, audit_fee, created_by)
      values (
        v_org,
        trim(v_row->>'company_name'),
        nullif(v_row->>'registration_number', ''),
        nullif(v_row->>'fye', '')::date,
        nullif(v_row->>'audit_fee', '')::numeric,
        auth.uid()
      )
      returning id into v_client_id;
    end if;

    -- PIC contact (only if at least one of name/email/phone is present, and not already recorded)
    if coalesce(v_row->>'pic_name','') <> '' or coalesce(v_row->>'pic_email','') <> '' or coalesce(v_row->>'pic_phone','') <> '' then
      if not exists (
        select 1 from client_contacts
        where client_id = v_client_id
          and coalesce(email,'') = coalesce(v_row->>'pic_email','')
          and coalesce(name,'') = coalesce(v_row->>'pic_name','')
      ) then
        insert into client_contacts (organisation_id, client_id, name, email, phone, is_primary)
        values (v_org, v_client_id, nullif(v_row->>'pic_name',''), nullif(v_row->>'pic_email',''), nullif(v_row->>'pic_phone',''), true);
      end if;
    end if;

    if coalesce(v_row->>'staff_alias', '') <> '' then
      insert into client_service_assignments (organisation_id, client_id, assigned_name_raw, assignment_role, service_type, mapping_status, assigned_user_id)
      select v_org, v_client_id, v_row->>'staff_alias', 'audit_staff', 'audit',
             case when sa.user_id is not null then 'mapped' else 'unresolved' end,
             sa.user_id
      from (select 1) x
      left join staff_aliases sa on sa.organisation_id = v_org and sa.alias = v_row->>'staff_alias' and sa.active
      on conflict do nothing;
    end if;

    if coalesce(v_row->>'partner_alias', '') <> '' then
      insert into client_service_assignments (organisation_id, client_id, assigned_name_raw, assignment_role, service_type, mapping_status, assigned_user_id)
      select v_org, v_client_id, v_row->>'partner_alias', 'audit_partner', 'audit',
             case when sa.user_id is not null then 'mapped' else 'unresolved' end,
             sa.user_id
      from (select 1) x
      left join staff_aliases sa on sa.organisation_id = v_org and sa.alias = v_row->>'partner_alias' and sa.active
      on conflict do nothing;
    end if;

    for v_deadline in select * from jsonb_array_elements(coalesce(v_row->'deadlines', '[]'::jsonb))
    loop
      if coalesce(v_deadline->>'deadline_date', '') = '' then
        continue;
      end if;
      insert into client_deadlines (organisation_id, client_id, deadline_type, deadline_date, financial_year_end, source, source_sheet, source_row, status, import_batch_id)
      values (
        v_org, v_client_id, v_deadline->>'deadline_type', (v_deadline->>'deadline_date')::date,
        nullif(v_row->>'fye', '')::date, 'imported_excel', 'Completed', (v_row->>'source_row')::int, 'not_due', import_batch_uuid
      )
      on conflict (organisation_id, client_id, deadline_type, deadline_date, source_sheet)
        where source = 'imported_excel'
      do nothing;
    end loop;

    insert into import_rows (import_batch_id, source_sheet, source_row, raw_payload, normalized_payload, validation_status, imported_entity_type, imported_entity_id)
    values (import_batch_uuid, 'Completed', (v_row->>'source_row')::int, v_row, v_row, 'valid', 'clients', v_client_id);

    v_inserted := v_inserted + 1;
  end loop;

  update import_batches
  set status = 'completed', valid_count = v_inserted, rejected_count = v_skipped
  where id = import_batch_uuid;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

-- ============================================================
-- 013_seed_organisation
-- ============================================================
insert into organisations (id, name, slug, status)
values ('00000000-0000-0000-0000-000000000001', 'NBL & Associates PLT', 'nbl-associates', 'active')
on conflict (id) do nothing;

insert into organisation_settings (organisation_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (organisation_id) do nothing;

insert into deadline_rules (organisation_id, deadline_type, offset_months, offset_days) values
  ('00000000-0000-0000-0000-000000000001', 'Financial Statements Circulation', 6, 0),
  ('00000000-0000-0000-0000-000000000001', 'SSM Submission Planning', 7, 0),
  ('00000000-0000-0000-0000-000000000001', 'CP204 Deadline', 0, -30),
  ('00000000-0000-0000-0000-000000000001', 'CP204A 6th Deadline', 6, -30),
  ('00000000-0000-0000-0000-000000000001', 'CP204A 9th Deadline', 9, -30),
  ('00000000-0000-0000-0000-000000000001', 'CP204A 11th Deadline', 11, -30);

insert into ai_tools (organisation_id, name, url, description, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Financial Statement Review',
   'https://nbla.app.n8n.cloud/form/7820c4ea-931a-4792-98df-c17d53a62261',
   'Generate manager review checklists from financial statement PDFs.', 1);

-- ============================================================
-- 014_security_hardening
-- ============================================================
alter function public.set_updated_at() set search_path = public;

revoke execute on function public.current_organisation_ids() from public;
revoke execute on function public.is_firm_admin(uuid) from public;
revoke execute on function public.generate_client_deadlines(uuid) from public;
revoke execute on function public.approve_work_order(uuid, text) from public;
revoke execute on function public.reject_work_order(uuid, text) from public;
revoke execute on function public.mark_deadline_completed(uuid, date, text) from public;
revoke execute on function public.import_completed_rows(uuid, jsonb) from public;

revoke execute on function public.current_organisation_ids() from anon;
revoke execute on function public.is_firm_admin(uuid) from anon;
revoke execute on function public.generate_client_deadlines(uuid) from anon;
revoke execute on function public.approve_work_order(uuid, text) from anon;
revoke execute on function public.reject_work_order(uuid, text) from anon;
revoke execute on function public.mark_deadline_completed(uuid, date, text) from anon;
revoke execute on function public.import_completed_rows(uuid, jsonb) from anon;

grant execute on function public.generate_client_deadlines(uuid) to authenticated;
grant execute on function public.approve_work_order(uuid, text) to authenticated;
grant execute on function public.reject_work_order(uuid, text) to authenticated;
grant execute on function public.mark_deadline_completed(uuid, date, text) to authenticated;
grant execute on function public.import_completed_rows(uuid, jsonb) to authenticated;

-- ============================================================
-- 016_import_completed_rows_add_contacts
-- (adds PIC name/email/phone -> client_contacts; see current CREATE OR
--  REPLACE of import_completed_rows above, which already reflects this)
-- ============================================================

-- ============================================================
-- 017_remove_jmb_and_date_control
-- ============================================================
-- audit_work_plans, jmb_tax_tracking, import_jmb_tax_rows(), and
-- import_date_control_rows() were dropped entirely — the "JMB Tax
-- Allocation" and "Date Control" sheets were included in the original
-- spec by mistake. Nothing further to reproduce here; they're simply
-- absent from this schema going forward.
