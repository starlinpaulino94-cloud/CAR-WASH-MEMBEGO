-- =============================================================================
-- 0022 · Reporte gerencial con margen real
-- =============================================================================
-- Auditoría y analítica son cosas distintas: la bitácora es un registro técnico
-- inalterable; esto es el tablero del dueño. Un solo RPC agrega, para un rango
-- de fechas y SIEMPRE dentro del tenant del solicitante:
--
--   ventas (sin notas de crédito), ticket promedio, cobros por método,
--   ventas por servicio / producto / empleado, gastos por categoría,
--   compras y cuentas por pagar, costo de insumos consumidos (recetas)
--   y margen por servicio (ventas − insumos).
--
-- SECURITY INVOKER a propósito: cada subtotal pasa por las políticas RLS del
-- solicitante; la función no puede leer más de lo que su rol ya puede ver.
-- =============================================================================

create or replace function public.management_report(
  p_from date,
  p_to   date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_sales   jsonb;
  v_result  jsonb;
begin
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  -- Ventas del periodo: facturas vigentes, excluyendo notas de crédito (B04).
  select jsonb_build_object(
    'total_cents',    coalesce(sum(total_cents) filter (where not is_annulled), 0),
    'invoice_count',  count(*) filter (where not is_annulled),
    'annulled_cents', coalesce(sum(total_cents) filter (where is_annulled), 0),
    'annulled_count', count(*) filter (where is_annulled),
    'avg_ticket_cents',
      case when count(*) filter (where not is_annulled) = 0 then 0
           else (sum(total_cents) filter (where not is_annulled)
                 / count(*) filter (where not is_annulled))::bigint end
  ) into v_sales
  from public.invoices
  where company_id = v_company
    and created_at >= p_from and created_at < p_to + 1
    and ncf_type is distinct from 'B04';

  v_result := jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales', v_sales,

    -- Cobros registrados en caja por método (entradas ligadas a facturas).
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'amount_cents', amount) order by amount desc)
      from (
        select m.method, sum(m.amount_cents) as amount
        from public.cash_movements m
        where m.company_id = v_company and m.type = 'inflow'
          and m.created_at >= p_from and m.created_at < p_to + 1
        group by m.method
      ) t
    ), '[]'::jsonb),

    -- Ventas por servicio (renglones de facturas vigentes).
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', service_id, 'name', name, 'qty', qty, 'sales_cents', amount
      ) order by amount desc)
      from (
        select ii.service_id, ii.name, sum(ii.quantity) as qty,
               sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) as amount
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.company_id = v_company and not i.is_annulled
          and i.ncf_type is distinct from 'B04'
          and i.created_at >= p_from and i.created_at < p_to + 1
          and ii.item_type = 'service'
        group by ii.service_id, ii.name
      ) t
    ), '[]'::jsonb),

    -- Ventas por producto.
    'by_product', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'qty', qty, 'sales_cents', amount
      ) order by amount desc)
      from (
        select ii.product_id, ii.name, sum(ii.quantity) as qty,
               sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) as amount
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.company_id = v_company and not i.is_annulled
          and i.ncf_type is distinct from 'B04'
          and i.created_at >= p_from and i.created_at < p_to + 1
          and ii.item_type = 'product'
        group by ii.product_id, ii.name
      ) t
    ), '[]'::jsonb),

    -- Ventas por cajero.
    'by_employee', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', cashier_id, 'name', full_name, 'invoice_count', n, 'sales_cents', amount
      ) order by amount desc)
      from (
        select i.cashier_id, coalesce(p.full_name, '—') as full_name,
               count(*) as n, sum(i.total_cents) as amount
        from public.invoices i
        left join public.profiles p on p.id = i.cashier_id
        where i.company_id = v_company and not i.is_annulled
          and i.ncf_type is distinct from 'B04'
          and i.created_at >= p_from and i.created_at < p_to + 1
        group by i.cashier_id, p.full_name
      ) t
    ), '[]'::jsonb),

    -- Gastos del periodo por categoría.
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'amount_cents', amount) order by amount desc)
      from (
        select category, sum(amount_cents) as amount
        from public.expenses
        where company_id = v_company
          and expense_date between p_from and p_to
        group by category
      ) t
    ), '[]'::jsonb),
    'expenses_total_cents', coalesce((
      select sum(amount_cents) from public.expenses
      where company_id = v_company and expense_date between p_from and p_to
    ), 0),

    -- Compras del periodo y cuentas por pagar VIGENTES (independiente del rango).
    'purchases_total_cents', coalesce((
      select sum(total_cents) from public.purchases
      where company_id = v_company and status = 'recibida'
        and purchase_date between p_from and p_to
    ), 0),
    'payables_cents', coalesce((
      select sum(total_cents - paid_cents) from public.purchases
      where company_id = v_company and status = 'recibida'
        and paid_cents < total_cents
    ), 0),

    -- Costo de insumos consumidos por recetas en el periodo.
    'consumption_cents', coalesce((
      select sum(cost_cents) from public.service_consumptions
      where company_id = v_company
        and created_at >= p_from and created_at < p_to + 1
    ), 0),

    -- Margen por servicio: ventas del servicio − costo de insumos consumidos.
    'service_margin', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', sid, 'name', sname,
        'sales_cents', sales, 'consumption_cents', cons,
        'margin_cents', sales - cons
      ) order by (sales - cons) desc)
      from (
        select coalesce(v.service_id, c.service_id) as sid,
               coalesce(v.name, s.name, '—') as sname,
               coalesce(v.amount, 0) as sales,
               coalesce(c.cost, 0) as cons
        from (
          select ii.service_id, ii.name,
                 sum(ii.quantity * ii.unit_price_cents - ii.discount_cents) as amount
          from public.invoice_items ii
          join public.invoices i on i.id = ii.invoice_id
          where i.company_id = v_company and not i.is_annulled
            and i.ncf_type is distinct from 'B04'
            and i.created_at >= p_from and i.created_at < p_to + 1
            and ii.item_type = 'service' and ii.service_id is not null
          group by ii.service_id, ii.name
        ) v
        full outer join (
          select service_id, sum(cost_cents) as cost
          from public.service_consumptions
          where company_id = v_company and service_id is not null
            and created_at >= p_from and created_at < p_to + 1
          group by service_id
        ) c on c.service_id = v.service_id
        left join public.services s on s.id = coalesce(v.service_id, c.service_id)
      ) t
    ), '[]'::jsonb)
  );

  -- Utilidad bruta estimada del periodo: ventas − insumos consumidos − gastos.
  v_result := v_result || jsonb_build_object(
    'gross_profit_cents',
      (v_sales ->> 'total_cents')::bigint
      - (v_result ->> 'consumption_cents')::bigint
      - (v_result ->> 'expenses_total_cents')::bigint
  );

  return v_result;
end;
$$;

grant execute on function public.management_report(date, date) to authenticated;

comment on function public.management_report is
  'Reporte gerencial del periodo: ventas, métodos, servicios, productos, '
  'empleados, gastos, compras, insumos consumidos y margen. SECURITY INVOKER: '
  'la RLS del solicitante acota cada subtotal a su empresa.';
