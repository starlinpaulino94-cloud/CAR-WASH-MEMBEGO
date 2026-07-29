-- =============================================================================
-- 0007 · Row-Level Security
-- =============================================================================
-- Toda la superficie de seguridad en un solo archivo, para que sea auditable de
-- una lectura en lugar de estar repartida entre migraciones.
--
-- Reglas del diseño:
--   1. RLS activo en TODAS las tablas de negocio. Sin excepciones.
--   2. FORCE ROW LEVEL SECURITY: se aplica también al propietario de la tabla.
--   3. Fallo cerrado: sin política que lo permita, no hay acceso. Un usuario sin
--      empresa asignada (recién registrado) no ve absolutamente nada.
--   4. El aislamiento entre empresas es SIEMPRE company_id = app.current_company_id().
--      Nunca se delega en que la interfaz recuerde filtrar.
-- =============================================================================

-- Atajo: activa RLS y la fuerza en la tabla indicada.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'branches', 'profiles',
    'services', 'service_prices', 'products', 'bays',
    'customers', 'vehicles',
    'work_orders', 'work_order_items',
    'cash_sessions', 'cash_movements',
    'ncf_sequences', 'invoices', 'invoice_items',
    'expenses', 'commissions', 'audit_logs',
    'document_counters'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- =============================================================================
-- Empresas y sucursales
-- =============================================================================

create policy companies_select on public.companies
  for select to authenticated
  using (id = app.current_company_id());

-- Solo el propietario modifica los datos fiscales de la empresa.
create policy companies_update on public.companies
  for update to authenticated
  using (id = app.current_company_id() and app.has_role('propietario', 'superadmin'))
  with check (id = app.current_company_id());

create policy branches_select on public.branches
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy branches_write on public.branches
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Perfiles
-- =============================================================================

-- Cada quien se ve a sí mismo; el resto del directorio, solo dentro del tenant.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_tenant on public.profiles
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Datos propios editables, PERO sin poder cambiar empresa ni rol: eso sería
-- una escalada de privilegios en una sola sentencia UPDATE.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and company_id is not distinct from app.current_company_id()
    and role is not distinct from app.current_role()
  );

create policy profiles_admin_manage on public.profiles
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- -------------------------------------------------------------------
-- Barreras RESTRICTIVE contra la escalada de privilegios.
--
-- Las políticas permisivas se combinan con OR: `profiles_admin_manage`
-- permitía a un propietario o administrador editar CUALQUIER fila de su
-- empresa, incluida la suya, anulando el `with check` de
-- `profiles_update_self`. Un propietario podía convertirse en superadmin con
-- un solo UPDATE. Las políticas RESTRICTIVE se combinan con AND, así que se
-- aplican siempre, por encima de cualquier permiso concedido arriba.
--
-- Detectado por la batería de pruebas de RLS, no por revisión visual.
-- -------------------------------------------------------------------

-- Nadie modifica su propia empresa ni su propio rol. Ni el propietario.
-- Cambiar de rol a alguien es siempre una acción sobre OTRA persona.
create policy profiles_no_self_escalation on public.profiles
  as restrictive
  for update to authenticated
  using (true)
  with check (
    id <> auth.uid()
    or (
      company_id is not distinct from app.current_company_id()
      and role is not distinct from app.current_role()
    )
  );

-- Techo de concesión: para otorgar los roles de mayor privilegio hay que
-- tenerlos. Impide que un administrador fabrique propietarios o superadmins.
create policy profiles_role_ceiling_update on public.profiles
  as restrictive
  for update to authenticated
  using (true)
  with check (
    role is null
    or role not in ('propietario', 'superadmin')
    or app.has_role('propietario', 'superadmin')
  );

create policy profiles_role_ceiling_insert on public.profiles
  as restrictive
  for insert to authenticated
  with check (
    role is null
    or role not in ('propietario', 'superadmin')
    or app.has_role('propietario', 'superadmin')
  );

-- =============================================================================
-- Catálogo
-- =============================================================================

create policy services_select on public.services
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Cambiar precios es una acción sensible: queda restringida y auditada.
create policy services_write on public.services
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- service_prices no lleva company_id: hereda el tenant de su servicio.
create policy service_prices_select on public.service_prices
  for select to authenticated
  using (exists (
    select 1 from public.services s
    where s.id = service_id and app.belongs_to_tenant(s.company_id)
  ));

create policy service_prices_write on public.service_prices
  for all to authenticated
  using (exists (
    select 1 from public.services s
    where s.id = service_id and app.belongs_to_tenant(s.company_id)
  ) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (exists (
    select 1 from public.services s
    where s.id = service_id and app.belongs_to_tenant(s.company_id)
  ));

create policy products_select on public.products
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- El stock lo ajusta también el cajero (venta) y el supervisor (mermas).
create policy products_write on public.products
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

create policy bays_select on public.bays
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy bays_write on public.bays
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Clientes y vehículos
-- =============================================================================

create policy customers_select on public.customers
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy customers_write on public.customers
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

create policy vehicles_select on public.vehicles
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy vehicles_write on public.vehicles
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Órdenes de trabajo
-- =============================================================================

create policy work_orders_select on public.work_orders
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy work_orders_insert on public.work_orders
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

create policy work_orders_update on public.work_orders
  for update to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

-- Nadie borra órdenes: se cancelan. Ausencia deliberada de política DELETE.

create policy work_order_items_select on public.work_order_items
  for select to authenticated
  using (exists (
    select 1 from public.work_orders o
    where o.id = work_order_id and app.belongs_to_tenant(o.company_id)
  ));

create policy work_order_items_write on public.work_order_items
  for all to authenticated
  using (exists (
    select 1 from public.work_orders o
    where o.id = work_order_id and app.belongs_to_tenant(o.company_id)
  ))
  with check (exists (
    select 1 from public.work_orders o
    where o.id = work_order_id and app.belongs_to_tenant(o.company_id)
  ));

-- =============================================================================
-- Caja
-- =============================================================================

create policy cash_sessions_select on public.cash_sessions
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy cash_sessions_insert on public.cash_sessions
  for insert to authenticated
  with check (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'superadmin')
  );

create policy cash_sessions_update on public.cash_sessions
  for update to authenticated
  using (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'superadmin')
  )
  with check (app.belongs_to_tenant(company_id));

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

-- Los movimientos solo se insertan. Corregir un error exige un asiento
-- compensatorio, no reescribir el histórico.
create policy cash_movements_insert on public.cash_movements
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Facturación y fiscalidad
-- =============================================================================

-- Los rangos NCF solo los ve y gestiona la administración: son un recurso
-- fiscal controlado, no un dato operativo.
create policy ncf_sequences_select on public.ncf_sequences
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'contador', 'superadmin'));

create policy ncf_sequences_write on public.ncf_sequences
  for all to authenticated
  using (app.belongs_to_tenant(company_id) and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

create policy invoices_select on public.invoices
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'cajero', 'superadmin')
  );

-- Anular es la acción más sensible del sistema. En la aplicación auditada
-- estaba disponible para cualquiera, sin confirmación y con motivo codificado.
create policy invoices_annul on public.invoices
  for update to authenticated
  using (
    app.belongs_to_tenant(company_id)
    and app.has_role('propietario', 'administrador', 'supervisor', 'superadmin')
  )
  with check (app.belongs_to_tenant(company_id));

-- Sin política DELETE: una factura emitida no se borra jamás.

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.belongs_to_tenant(i.company_id)
  ));

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and app.belongs_to_tenant(i.company_id)
  ));

-- =============================================================================
-- Gastos y comisiones
-- =============================================================================

create policy expenses_select on public.expenses
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy expenses_write on public.expenses
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'cajero', 'contador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- Un operario ve sus propias comisiones y nada más.
create policy commissions_select_own on public.commissions
  for select to authenticated
  using (profile_id = auth.uid());

create policy commissions_select_management on public.commissions
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin'));

create policy commissions_write on public.commissions
  for all to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'superadmin'))
  with check (app.belongs_to_tenant(company_id));

-- =============================================================================
-- Auditoría y contadores
-- =============================================================================

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (app.belongs_to_tenant(company_id)
         and app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin'));

-- Cualquier usuario del tenant puede dejar constancia; el trigger sella quién.
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

-- Los contadores de documentos no se tocan directamente: solo a través de
-- app.next_document_number(), que es SECURITY DEFINER. Sin políticas para
-- `authenticated`, RLS los deja fuera de alcance por completo.

-- =============================================================================
-- Permisos base
-- =============================================================================

-- El rol anónimo no tiene nada que hacer aquí: no hay superficie pública.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Y por encima de los grants mandan las políticas de arriba.
revoke delete on all tables in schema public from authenticated;
revoke update, delete on public.audit_logs from authenticated;
revoke all on public.document_counters from authenticated;
