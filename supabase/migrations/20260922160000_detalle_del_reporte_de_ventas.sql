-- =============================================================================
-- EL DETALLE DETRÁS DE CADA CANTIDAD DEL REPORTE DE VENTAS
--
-- El reporte impreso decía «Lavado Básico · 2 · RD$ 1,000» y ahí se acababa.
-- Con eso no se puede revisar nada: no dice CUÁLES fueron esos dos lavados, ni
-- a qué vehículo, ni quién los facturó. Para comprobar un turno había que
-- volver a la pantalla, abrir el drill-down fila por fila y cotejar a mano.
--
-- Esta función devuelve los RENGLONES que hay detrás de esas cantidades, del
-- MISMO universo que `sales_report`: los mismos siete filtros, la misma
-- definición de día operativo, la misma exclusión de notas de crédito y la
-- misma regla sobre anuladas.
--
-- Eso último no es un detalle de copia: `por_servicio` suma solo renglones de
-- facturas VIGENTES (`not u.is_annulled`). Si el detalle incluyera las
-- anuladas, el papel tendría una tabla que no suma lo que dice su propio
-- resumen, y un reporte que se contradice a sí mismo es peor que uno escueto.
-- Por eso el filtro va idéntico, y por eso está escrito aquí al lado.
--
-- EL TOPE
--
-- Un mes entero puede ser mucho renglón. Se corta en `p_limit` y se DICE que se
-- cortó (`truncated`), para que quien imprima sepa que está viendo una parte.
-- Cortar en silencio convertiría el reporte en una mentira con buena letra.
-- =============================================================================

create or replace function public.sales_report_lines(
  p_from    date,
  p_to      date,
  p_filtros jsonb default '{}'::jsonb,
  p_limit   integer default 2000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_tz       text;
  v_branch   uuid := nullif(p_filtros ->> 'branch_id', '')::uuid;
  v_cashier  uuid := nullif(p_filtros ->> 'cashier_id', '')::uuid;
  v_washer   uuid := nullif(p_filtros ->> 'washer_id', '')::uuid;
  v_service  uuid := nullif(p_filtros ->> 'service_id', '')::uuid;
  v_scat     text := nullif(p_filtros ->> 'service_category', '');
  v_method   text := nullif(p_filtros ->> 'payment_method', '');
  v_limit    integer := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  v_total    bigint;
  v_rows     jsonb;
begin
  -- Mismo portero que `sales_report`: quien no puede ver el resumen tampoco
  -- puede ver el desglose, que dice MÁS.
  if v_company is null
     or not app.has_role('propietario', 'administrador', 'supervisor', 'contador', 'superadmin') then
    raise exception 'Su rol no permite consultar los reportes gerenciales.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Rango de fechas inválido.' using errcode = 'check_violation';
  end if;

  select timezone into v_tz from public.companies where id = v_company;

  with universo as (
    select i.*
    from public.invoices i
    where i.company_id = v_company
      and app.dia_operativo(i.created_at, v_tz) between p_from and p_to
      and i.ncf_type is distinct from 'B04'
      and (v_branch  is null or i.branch_id  = v_branch)
      and (v_cashier is null or i.cashier_id = v_cashier)
      and (v_method  is null or exists (
            select 1 from public.cash_movements cm
            where cm.invoice_id = i.id and cm.method = v_method::app.payment_method))
      and (v_service is null or exists (
            select 1 from public.invoice_items ii
            where ii.invoice_id = i.id and ii.service_id = v_service))
      and (v_scat is null or exists (
            select 1 from public.invoice_items ii
            join public.services s on s.id = ii.service_id
            where ii.invoice_id = i.id and s.category = v_scat))
      and (v_washer is null or exists (
            select 1 from public.work_order_assignees wa
            where wa.work_order_id = i.work_order_id and wa.profile_id = v_washer))
  ),
  -- Solo VIGENTES, igual que `por_servicio` y `por_producto`: el detalle tiene
  -- que sumar exactamente lo que dice el resumen de arriba.
  renglones as (
    select
      ii.item_type::text                                        as kind,
      coalesce(ii.service_id, ii.product_id)                    as item_id,
      ii.name                                                   as item_name,
      ii.quantity                                               as quantity,
      (ii.quantity * ii.unit_price_cents - ii.discount_cents)   as amount_cents,
      u.id                                                      as invoice_id,
      u.invoice_number                                          as invoice_number,
      u.created_at                                              as created_at,
      u.customer_name                                           as customer_name,
      u.vehicle_plate                                           as vehicle_plate,
      (select pr.full_name from public.profiles pr where pr.id = u.cashier_id) as cashier_name
    from public.invoice_items ii
    join universo u on u.id = ii.invoice_id
    where not u.is_annulled
  ),
  contado as (select count(*)::bigint as n from renglones),
  pagina as (
    -- Ordenado por concepto y luego por fecha: así el papel agrupa «los dos
    -- lavados básicos» uno detrás de otro sin que el cliente tenga que ordenar.
    select * from renglones order by item_name, created_at limit v_limit
  )
  select (select n from contado),
         coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'item_id', item_id, 'item_name', item_name,
           'quantity', quantity, 'amount_cents', amount_cents,
           'invoice_id', invoice_id, 'invoice_number', invoice_number,
           'created_at', created_at, 'customer_name', customer_name,
           'vehicle_plate', vehicle_plate, 'cashier_name', cashier_name
         ) order by item_name, created_at), '[]'::jsonb)
    into v_total, v_rows
    from pagina;

  return jsonb_build_object(
    'total', v_total,
    'rows', v_rows,
    'limit', v_limit,
    'truncated', v_total > v_limit
  );
end;
$$;

grant execute on function public.sales_report_lines(date, date, jsonb, integer) to authenticated;

comment on function public.sales_report_lines is
  'Los renglones que hay detrás de las cantidades de sales_report: mismo '
  'universo y mismos filtros, con factura, vehículo, cliente y cajero. Solo '
  'facturas vigentes, para que el detalle sume lo mismo que el resumen.';
