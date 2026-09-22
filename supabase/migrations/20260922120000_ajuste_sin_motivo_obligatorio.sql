-- =============================================================================
-- EL MOTIVO DEL AJUSTE DEJA DE SER OBLIGATORIO
--
-- `adjust_stock` exigía un motivo de cinco caracteres o más y, si no llegaba,
-- rechazaba el ajuste entero. En el mostrador eso significa que quien acaba de
-- contar la nevera y ve 24 cervezas donde el sistema dice 1 no puede corregirlo
-- hasta redactar una frase. Lo que pasa entonces no es que se escriban buenos
-- motivos: es que se escribe «24», o «xxxxx», o no se ajusta y el inventario se
-- queda mintiendo. Un campo obligatorio que se rellena con ruido no documenta
-- nada y sí impide trabajar.
--
-- LO QUE NO CAMBIA, QUE ES LO IMPORTANTE
--
-- Todo sigue quedando registrado, y eso nunca dependió del motivo. Cada ajuste
-- escribe una fila en `inventory_movements` con el producto, cuánto había,
-- cuánto hay, la diferencia, QUIÉN lo hizo y CUÁNDO —el trigger
-- `products_stock_guard` lo sella con `auth.uid()`, no con lo que diga el
-- cliente— y además una entrada en `audit_logs`. La existencia sigue sin
-- poderse editar a mano por ningún otro camino.
--
-- El motivo pasa a ser lo que siempre debió ser: un comentario útil cuando hay
-- algo que decir, no un peaje. Y como ahora puede faltar, el rastro se escribe
-- de forma que se entienda igual sin él: «sin motivo indicado» es un dato, y
-- dice más que una cadena de relleno.
--
-- El rol NO se toca: sigue siendo supervisor o superior. Quitar la fricción de
-- escribir una frase no es lo mismo que abrir el inventario a cualquiera.
-- =============================================================================

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_new_qty    integer,
  p_reason     text default null
)
returns public.products
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company uuid := app.current_company_id();
  v_product public.products;
  v_before  integer;
  -- Vacío, espacios o nulo son todos «no dijo nada». Se normaliza una vez aquí
  -- para que el kardex y la bitácora cuenten lo mismo.
  v_reason  text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite ajustar inventario.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_product from public.products
  where id = p_product_id and company_id = v_company
  for update;
  if v_product.id is null then
    raise exception 'Producto inexistente o fuera de su alcance.' using errcode = 'no_data_found';
  end if;
  if v_product.stock = p_new_qty then
    return v_product;  -- nada que hacer, sin movimiento vacío
  end if;
  v_before := v_product.stock;

  -- `reason` va nulo cuando no lo hay, no con un texto inventado: el kardex
  -- debe poder distinguir «no se dijo» de «se dijo esto».
  perform set_config('app.inventory_ctx', jsonb_build_object(
    'kind', 'ajuste', 'reason', v_reason
  )::text, true);

  update public.products set stock = p_new_qty
  where id = p_product_id and company_id = v_company
  returning * into v_product;

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_product.branch_id, 'AJUSTAR_INVENTARIO', 'product', v_product.id,
          format('%s: %s → %s (%s)', v_product.name, v_before, p_new_qty,
                 coalesce(v_reason, 'sin motivo indicado')));

  return v_product;
end;
$$;

comment on function public.adjust_stock is
  'Ajusta la existencia de un producto. El motivo es opcional; el movimiento '
  'queda igualmente en el kardex con el antes, el después, el autor y la hora.';
