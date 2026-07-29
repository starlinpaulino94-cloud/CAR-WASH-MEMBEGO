-- =============================================================================
-- 0009 · Integridad de tenant mediante claves foráneas compuestas
-- =============================================================================
-- Cierra una vulnerabilidad de corrupción financiera entre empresas encontrada
-- atacando el propio esquema.
--
-- EL FALLO
-- Las políticas RLS validan `company_id`, pero las claves foráneas
-- (`cash_session_id`, `branch_id`, `customer_id`, ...) las envía el cliente y
-- nadie comprobaba que apuntasen al mismo tenant. Con el UUID de la sesión de
-- caja de otra empresa —un valor que la API acepta sin más— el cajero de la
-- empresa A podía insertar un movimiento con `company_id` = A y
-- `cash_session_id` = caja de B. RLS lo aceptaba (company_id era el suyo) y el
-- trigger `app.recalc_cash_session`, que es SECURITY DEFINER, recalculaba
-- alegremente la caja de B.
--
-- Reproducido: una salida de 400.000 contra la caja de la empresa vecina
-- cambió su efectivo esperado de 0 a 100.000.
--
-- LA CORRECCIÓN
-- No un trigger de validación —que habría que recordar poner en cada tabla
-- nueva— sino claves foráneas COMPUESTAS que incluyen company_id. Con ellas el
-- desajuste de tenant es estructuralmente imposible: PostgreSQL no permite
-- siquiera describir la fila incoherente.
-- =============================================================================

-- ------------------------------------------------- Claves candidatas compuestas
-- Necesarias para poder referenciarlas desde las FK compuestas.
--
-- NOTA sobre ON DELETE SET NULL: en una clave foránea compuesta, la forma
-- simple anula TODAS las columnas del lado hijo, company_id incluida — que es
-- NOT NULL, de modo que borrar el padre reventaba la operación. Se acota con
-- `on delete set null (columna)`, sintaxis disponible desde PostgreSQL 15.
-- Lo detectó el borrado de una sesión de caja en las pruebas.

alter table public.branches      add constraint branches_id_company_key      unique (id, company_id);
alter table public.customers     add constraint customers_id_company_key     unique (id, company_id);
alter table public.vehicles      add constraint vehicles_id_company_key      unique (id, company_id);
alter table public.services      add constraint services_id_company_key      unique (id, company_id);
alter table public.products      add constraint products_id_company_key      unique (id, company_id);
alter table public.bays          add constraint bays_id_company_key          unique (id, company_id);
alter table public.work_orders   add constraint work_orders_id_company_key   unique (id, company_id);
alter table public.cash_sessions add constraint cash_sessions_id_company_key unique (id, company_id);
alter table public.invoices      add constraint invoices_id_company_key      unique (id, company_id);
alter table public.profiles      add constraint profiles_id_company_key      unique (id, company_id);
alter table public.expenses      add constraint expenses_id_company_key      unique (id, company_id);

-- ------------------------------------------------------------- Perfiles

alter table public.profiles drop constraint profiles_branch_id_fkey;
alter table public.profiles
  add constraint profiles_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id)
  on delete set null (branch_id);

-- ------------------------------------------------------------- Catálogo

alter table public.products drop constraint products_branch_id_fkey;
alter table public.products
  add constraint products_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id)
  on delete set null (branch_id);

alter table public.bays drop constraint bays_branch_id_fkey;
alter table public.bays
  add constraint bays_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id)
  on delete cascade;

alter table public.bays drop constraint bays_current_work_order_fk;
alter table public.bays
  add constraint bays_work_order_same_company
  foreign key (current_work_order_id, company_id) references public.work_orders(id, company_id)
  on delete set null (current_work_order_id);

alter table public.vehicles drop constraint vehicles_customer_id_fkey;
alter table public.vehicles
  add constraint vehicles_customer_same_company
  foreign key (customer_id, company_id) references public.customers(id, company_id)
  on delete set null (customer_id);

-- ------------------------------------------------------------- Órdenes

alter table public.work_orders drop constraint work_orders_branch_id_fkey;
alter table public.work_orders
  add constraint work_orders_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.work_orders drop constraint work_orders_customer_id_fkey;
alter table public.work_orders
  add constraint work_orders_customer_same_company
  foreign key (customer_id, company_id) references public.customers(id, company_id)
  on delete set null (customer_id);

alter table public.work_orders drop constraint work_orders_vehicle_id_fkey;
alter table public.work_orders
  add constraint work_orders_vehicle_same_company
  foreign key (vehicle_id, company_id) references public.vehicles(id, company_id)
  on delete set null (vehicle_id);

alter table public.work_orders drop constraint work_orders_bay_id_fkey;
alter table public.work_orders
  add constraint work_orders_bay_same_company
  foreign key (bay_id, company_id) references public.bays(id, company_id)
  on delete set null (bay_id);

-- ------------------------------------------------------------- Caja

alter table public.cash_sessions drop constraint cash_sessions_branch_id_fkey;
alter table public.cash_sessions
  add constraint cash_sessions_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

-- La que hacía posible el ataque descrito arriba.
alter table public.cash_movements drop constraint cash_movements_cash_session_id_fkey;
alter table public.cash_movements
  add constraint cash_movements_session_same_company
  foreign key (cash_session_id, company_id) references public.cash_sessions(id, company_id);

alter table public.cash_movements drop constraint cash_movements_invoice_fk;
alter table public.cash_movements
  add constraint cash_movements_invoice_same_company
  foreign key (invoice_id, company_id) references public.invoices(id, company_id)
  on delete set null (invoice_id);

-- ------------------------------------------------------------- Facturación

alter table public.invoices drop constraint invoices_branch_id_fkey;
alter table public.invoices
  add constraint invoices_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.invoices drop constraint invoices_work_order_id_fkey;
alter table public.invoices
  add constraint invoices_work_order_same_company
  foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
  on delete set null (work_order_id);

alter table public.invoices drop constraint invoices_customer_id_fkey;
alter table public.invoices
  add constraint invoices_customer_same_company
  foreign key (customer_id, company_id) references public.customers(id, company_id)
  on delete set null (customer_id);

alter table public.invoices drop constraint invoices_cash_session_id_fkey;
alter table public.invoices
  add constraint invoices_cash_session_same_company
  foreign key (cash_session_id, company_id) references public.cash_sessions(id, company_id)
  on delete set null (cash_session_id);

alter table public.invoices drop constraint invoices_credits_invoice_id_fkey;
alter table public.invoices
  add constraint invoices_credits_same_company
  foreign key (credits_invoice_id, company_id) references public.invoices(id, company_id);

alter table public.invoices drop constraint invoices_credit_note_id_fkey;
alter table public.invoices
  add constraint invoices_credit_note_same_company
  foreign key (credit_note_id, company_id) references public.invoices(id, company_id);

-- ------------------------------------------------------- Gastos y comisiones

alter table public.expenses drop constraint expenses_branch_id_fkey;
alter table public.expenses
  add constraint expenses_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.expenses drop constraint expenses_cash_session_id_fkey;
alter table public.expenses
  add constraint expenses_cash_session_same_company
  foreign key (cash_session_id, company_id) references public.cash_sessions(id, company_id)
  on delete set null (cash_session_id);

alter table public.cash_movements drop constraint cash_movements_expense_fk;
alter table public.cash_movements
  add constraint cash_movements_expense_same_company
  foreign key (expense_id, company_id) references public.expenses(id, company_id)
  on delete set null (expense_id);


alter table public.commissions drop constraint commissions_branch_id_fkey;
alter table public.commissions
  add constraint commissions_branch_same_company
  foreign key (branch_id, company_id) references public.branches(id, company_id);

alter table public.commissions drop constraint commissions_work_order_id_fkey;
alter table public.commissions
  add constraint commissions_work_order_same_company
  foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
  on delete cascade;

-- =============================================================================
-- Líneas de detalle: heredan el tenant del documento padre
-- =============================================================================
-- work_order_items e invoice_items no tenían company_id, así que una línea podía
-- referenciar el servicio o el producto de otra empresa. Se denormaliza la
-- columna, se rellena por trigger desde el padre y se encadena todo con FK
-- compuestas: el valor no lo pone el cliente.

alter table public.work_order_items add column company_id uuid;
alter table public.invoice_items    add column company_id uuid;

update public.work_order_items i
   set company_id = o.company_id
  from public.work_orders o where o.id = i.work_order_id;

update public.invoice_items i
   set company_id = v.company_id
  from public.invoices v where v.id = i.invoice_id;

alter table public.work_order_items alter column company_id set not null;
alter table public.invoice_items    alter column company_id set not null;

create or replace function app.inherit_company_from_work_order()
returns trigger language plpgsql as $$
begin
  select company_id into new.company_id
  from public.work_orders where id = new.work_order_id;
  if new.company_id is null then
    raise exception 'Orden de trabajo % inexistente', new.work_order_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create or replace function app.inherit_company_from_invoice()
returns trigger language plpgsql as $$
begin
  select company_id into new.company_id
  from public.invoices where id = new.invoice_id;
  if new.company_id is null then
    raise exception 'Factura % inexistente', new.invoice_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger work_order_items_inherit_company
  before insert or update of work_order_id on public.work_order_items
  for each row execute function app.inherit_company_from_work_order();

create trigger invoice_items_inherit_company
  before insert or update of invoice_id on public.invoice_items
  for each row execute function app.inherit_company_from_invoice();

alter table public.work_order_items drop constraint work_order_items_work_order_id_fkey;
alter table public.work_order_items
  add constraint work_order_items_order_same_company
  foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
  on delete cascade;

alter table public.work_order_items drop constraint work_order_items_service_id_fkey;
alter table public.work_order_items
  add constraint work_order_items_service_same_company
  foreign key (service_id, company_id) references public.services(id, company_id);

alter table public.work_order_items drop constraint work_order_items_product_id_fkey;
alter table public.work_order_items
  add constraint work_order_items_product_same_company
  foreign key (product_id, company_id) references public.products(id, company_id);

alter table public.invoice_items drop constraint invoice_items_invoice_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_invoice_same_company
  foreign key (invoice_id, company_id) references public.invoices(id, company_id)
  on delete cascade;

alter table public.invoice_items drop constraint invoice_items_service_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_service_same_company
  foreign key (service_id, company_id) references public.services(id, company_id);

alter table public.invoice_items drop constraint invoice_items_product_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_product_same_company
  foreign key (product_id, company_id) references public.products(id, company_id);

-- service_prices cuelga de services vía CASCADE, sin columna de tenant propia:
-- no admite desajuste posible.

-- --------------------------------------------------- RLS de las columnas nuevas

-- Ahora que las líneas llevan company_id, sus políticas pueden usarlo
-- directamente en lugar de un EXISTS contra el documento padre.
drop policy work_order_items_select on public.work_order_items;
drop policy work_order_items_write  on public.work_order_items;

create policy work_order_items_select on public.work_order_items
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy work_order_items_write on public.work_order_items
  for all to authenticated
  using (app.belongs_to_tenant(company_id))
  with check (app.belongs_to_tenant(company_id));

drop policy invoice_items_select on public.invoice_items;
drop policy invoice_items_insert on public.invoice_items;

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (app.belongs_to_tenant(company_id));

create index work_order_items_company_idx on public.work_order_items (company_id);
create index invoice_items_company_idx    on public.invoice_items (company_id);

-- --------------------------------------------------------------- Índices de FK

-- PostgreSQL no indexa automáticamente el lado hijo de una FK. Sin estos
-- índices, borrar una fila padre obliga a un recorrido secuencial del hijo.
create index if not exists cash_movements_invoice_idx on public.cash_movements (invoice_id);
create index if not exists cash_movements_expense_idx on public.cash_movements (expense_id);
create index if not exists invoices_work_order_idx    on public.invoices (work_order_id);
create index if not exists work_orders_bay_idx        on public.work_orders (bay_id);
create index if not exists work_orders_vehicle_idx    on public.work_orders (vehicle_id);
