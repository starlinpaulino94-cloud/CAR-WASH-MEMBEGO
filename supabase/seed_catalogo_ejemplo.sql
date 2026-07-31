-- =============================================================================
-- MEMBEGO CAR WASH — Catálogo inicial de ejemplo (servicios, precios, productos,
-- bahías) para arrancar la operación
-- =============================================================================
-- Ejecútalo en el editor SQL de Supabase DESPUÉS del bootstrap. Es una PLANTILLA
-- realista de lavadero dominicano: ajusta nombres y precios a los tuyos.
--
-- Precios en PESOS (RD$); el script los convierte a centavos (× 100).
-- Es idempotente: reejecutarlo no duplica (usa ON CONFLICT sobre las claves
-- únicas). Cambiar un precio aquí y reejecutar NO lo pisa: los precios se editan
-- mejor desde la app (Servicios & Paquetes). Para recargar de cero, borra antes.
-- =============================================================================

do $seed$
declare
  v_company uuid;
  v_branch  uuid;
begin
  -- Toma tu (única) empresa y su sucursal principal. Si tienes más de una
  -- empresa, fija el id a mano en la línea siguiente.
  select id into v_company from public.companies order by created_at limit 1;
  select id into v_branch  from public.branches where company_id = v_company and is_main limit 1;

  if v_company is null or v_branch is null then
    raise exception 'No hay empresa o sucursal principal. Ejecuta antes el bootstrap.';
  end if;

  -- ------------------------------------------------------------- Servicios
  insert into public.services
    (company_id, code, name, description, estimated_minutes, commission_bps, is_popular)
  values
    (v_company, 'LAV-01', 'Lavado Express',      'Lavado exterior rápido',                 20, 1000, true),
    (v_company, 'LAV-02', 'Lavado Completo',      'Exterior + interior + aromatizante',     40, 1000, true),
    (v_company, 'LAV-03', 'Lavado Premium',       'Completo + cera de protección',          60, 1200, false),
    (v_company, 'ASP-01', 'Aspirado Profundo',    'Aspirado de alfombras y tapicería',      20,  800, false),
    (v_company, 'MOT-01', 'Lavado de Motor',      'Desengrase y lavado del motor',          30, 1000, false),
    (v_company, 'PUL-01', 'Pulido y Encerado',    'Pulido de pintura y encerado a mano',    90, 1500, false),
    (v_company, 'DET-01', 'Detallado Completo',   'Detallado interior y exterior premium', 180, 1500, false)
  on conflict (company_id, code) do nothing;

  -- --------------------------------------------------- Precios por categoría
  -- (código, categoría, precio en PESOS). Deja fuera las categorías que un
  -- servicio no cubre (p. ej. detallado no aplica a moto).
  insert into public.service_prices (service_id, vehicle_category, price_cents)
  select s.id, v.cat::app.vehicle_category, (v.pesos * 100)::bigint
  from public.services s
  join (values
    ('LAV-01','sedan',300),('LAV-01','suv',400),('LAV-01','jeep',450),('LAV-01','pickup',450),('LAV-01','van',500),('LAV-01','motorcycle',150),
    ('LAV-02','sedan',500),('LAV-02','suv',650),('LAV-02','jeep',700),('LAV-02','pickup',700),('LAV-02','van',800),('LAV-02','motorcycle',250),
    ('LAV-03','sedan',800),('LAV-03','suv',1000),('LAV-03','jeep',1100),('LAV-03','pickup',1100),('LAV-03','van',1300),
    ('ASP-01','sedan',250),('ASP-01','suv',350),('ASP-01','jeep',400),('ASP-01','pickup',400),('ASP-01','van',450),
    ('MOT-01','sedan',400),('MOT-01','suv',500),('MOT-01','jeep',550),('MOT-01','pickup',550),('MOT-01','van',600),
    ('PUL-01','sedan',1500),('PUL-01','suv',2000),('PUL-01','jeep',2200),('PUL-01','pickup',2200),('PUL-01','van',2500),
    ('DET-01','sedan',3500),('DET-01','suv',4500),('DET-01','jeep',5000),('DET-01','pickup',5000),('DET-01','van',5500)
  ) as v(code, cat, pesos) on v.code = s.code
  where s.company_id = v_company
  on conflict (service_id, vehicle_category) do nothing;

  -- ------------------------------------------------------------- Productos
  -- (código, nombre, categoría, costo, precio, existencia, mínimo, unidad, a la venta)
  insert into public.products
    (company_id, branch_id, code, name, category, cost_cents, price_cents, stock, min_stock, unit, is_for_sale)
  values
    (v_company, v_branch, 'ARO-01', 'Aromatizante',           'Insumos',  6000,  15000,  50, 10, 'Unidad', true),
    (v_company, v_branch, 'TOA-01', 'Toalla de microfibra',   'Insumos', 12000,  25000,  30,  6, 'Unidad', true),
    (v_company, v_branch, 'CAF-01', 'Café',                   'Cortesía', 2000,   5000, 100, 20, 'Unidad', true),
    (v_company, v_branch, 'SHA-01', 'Shampoo para autos',     'Químicos',80000,      0,  12,  3, 'Galón',  false),
    (v_company, v_branch, 'CER-01', 'Cera líquida',           'Químicos',95000,      0,   8,  2, 'Galón',  false)
  on conflict (company_id, code) do nothing;

  -- --------------------------------------------------------------- Bahías
  insert into public.bays (company_id, branch_id, name, type)
  values
    (v_company, v_branch, 'Bahía 1',     'lavado'),
    (v_company, v_branch, 'Bahía 2',     'lavado'),
    (v_company, v_branch, 'Bahía 3',     'lavado'),
    (v_company, v_branch, 'Aspirado 1',  'aspirado'),
    (v_company, v_branch, 'Detallado 1', 'detallado')
  on conflict (branch_id, name) do nothing;

  raise notice 'Catálogo de ejemplo cargado para la empresa %.', v_company;
end $seed$;

-- Verificación rápida de lo que quedó cargado.
select 'servicios' as tipo, count(*) from public.services
union all select 'precios',  count(*) from public.service_prices
union all select 'productos',count(*) from public.products
union all select 'bahías',   count(*) from public.bays;
