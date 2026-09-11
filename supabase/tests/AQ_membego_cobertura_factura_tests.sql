-- =============================================================================
-- La regla del negocio, comprobada contra el SERVIDOR:
--
--   «Si el cliente tiene una membresía que cubre el lavado, el total le queda
--    en 0. Y lo mismo con cualquier membresía que tenga.»
--
-- Hasta ahora TODAS las pruebas de facturación pasaban `is_membego_covered`
-- en falso: el caso cubierto —que es el motivo entero de la integración con
-- Membego— nunca se había ejecutado aquí. La caja enseña «Cifras de
-- referencia: el importe definitivo lo calcula el servidor al emitir», así que
-- si el servidor no honrara la bandera, el cajero vería 0 y la factura saldría
-- completa. Nadie lo había comprobado.
-- =============================================================================

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

do $$
declare
  v_inv    public.invoices;
  v_precio bigint;
  v_prod   bigint;
  v_debido bigint;
begin
  -- El precio real del servicio en esta categoría, no uno inventado: si otra
  -- suite cambia la tarifa, la prueba tiene que seguir diciendo la verdad.
  select price_cents into v_precio
    from public.service_prices
   where service_id = test.var('serv')::uuid and vehicle_category = 'sedan';

  -- ── Un lavado cubierto por la membresía, y nada más ──────────────────────
  v_inv := public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'req-membego-cubierto-1',
    p_items            => jsonb_build_array(
      jsonb_build_object('item_type','service','service_id',test.var('serv'),
        'name','Lavado cubierto','quantity',1,'discount_cents',0,
        'is_membego_covered',true)),
    p_payments         => '[]'::jsonb,
    p_vehicle_category => 'sedan',
    p_ncf_type         => 'B02',
    -- Sin caja: estas facturas no reciben efectivo (una cubierta entera no
    -- cobra nada), y el RPC solo exige sesión abierta cuando hay efectivo.
    p_cash_session_id  => null
  );

  perform test.check('el subtotal sigue siendo el precio del lavado: la factura no miente sobre lo que valía',
    v_inv.subtotal_cents = v_precio, format('sub=%s precio=%s', v_inv.subtotal_cents, v_precio));
  -- Al EMITIR, lo cubierto se registra como descuento: es lo que hace que el
  -- total sea 0 y deja constancia en la propia factura de por qué lo es.
  -- `membego_covered_cents` es otra cosa —lo escribe `record_membego_redemption`
  -- cuando Membego confirma el canje— y por eso aquí todavía vale 0.
  perform test.check('lo cubierto queda registrado en la factura, no desaparece',
    v_inv.discount_cents = v_precio,
    format('descuento=%s precio=%s', v_inv.discount_cents, v_precio));
  -- Lo que el cliente paga. Es la frase del dueño, comprobada.
  perform test.check('el ITBIS de un lavado cubierto es 0: no se cobra impuesto sobre lo que no se cobra',
    v_inv.tax_cents = 0, format('tax=%s', v_inv.tax_cents));
  perform test.check('EL TOTAL LE QUEDA EN 0',
    v_inv.total_cents = 0, format('total=%s', v_inv.total_cents));

  -- ── Lo cubierto no arrastra a lo que no lo está ──────────────────────────
  select price_cents into v_prod from public.products where id = test.var('prod')::uuid;
  v_debido := v_prod + round(v_prod::numeric * 18 / 100)::bigint;
  -- Un ambientador no lo paga ninguna membresía de lavados: si la cobertura se
  -- comiera también los productos, el lavadero regalaría inventario.
  v_inv := public.create_invoice(
    p_branch_id        => test.var('b_a')::uuid,
    p_client_request_id=> 'req-membego-cubierto-2',
    p_items            => jsonb_build_array(
      jsonb_build_object('item_type','service','service_id',test.var('serv'),
        'name','Lavado cubierto','quantity',1,'discount_cents',0,
        'is_membego_covered',true),
      jsonb_build_object('item_type','product','product_id',test.var('prod'),
        'name','Aromatizante','quantity',1,'discount_cents',0,
        'is_membego_covered',false)),
    -- Con tarjeta: lo que se debe hay que pagarlo igual, y así no hace falta
    -- una sesión de caja abierta para esta comprobación.
    p_payments         => jsonb_build_array(jsonb_build_object(
                            'method','tarjeta','amount_cents',v_debido,'reference',null)),
    p_vehicle_category => 'sedan',
    p_ncf_type         => 'B02',
    -- Sin caja: estas facturas no reciben efectivo (una cubierta entera no
    -- cobra nada), y el RPC solo exige sesión abierta cuando hay efectivo.
    p_cash_session_id  => null
  );

  perform test.check('con un producto al lado, la membresía cubre SOLO el lavado',
    v_inv.discount_cents = v_precio,
    format('descuento=%s precio=%s', v_inv.discount_cents, v_precio));
  perform test.check('y el producto sí tributa: el total es el producto con su ITBIS',
    v_inv.total_cents = v_inv.subtotal_cents - v_precio
                      + round((v_inv.subtotal_cents - v_precio)::numeric * 18 / 100)::bigint,
    format('total=%s sub=%s', v_inv.total_cents, v_inv.subtotal_cents));
  perform test.check('y el total NO es cero cuando queda algo que no cubre la membresía',
    v_inv.total_cents > 0, format('total=%s', v_inv.total_cents));
end $$;

-- ── Una factura cubierta entera se emite sin cobrar nada ───────────────────
-- Si el sistema exigiera dinero por una factura de 0, el cajero no podría
-- cerrar la venta de un socio. Que exista con total 0 ya lo demuestra: el RPC
-- rechaza con «Pago insuficiente» cualquier factura con importe pendiente.
select test.check('una factura cubierta entera se emite sin recibir un peso',
  (select total_cents = 0 and change_cents = 0
     from public.invoices where client_request_id = 'req-membego-cubierto-1'));

-- ── Y cuando Membego confirma el canje, queda anotado CUÁNTO puso el plan ───
-- Es el dato con el que el dueño cuadra con Membego lo que regaló en lavados.
do $$
declare v_inv public.invoices; v_precio bigint;
begin
  select price_cents into v_precio from public.service_prices
   where service_id = test.var('serv')::uuid and vehicle_category = 'sedan';

  v_inv := public.record_membego_redemption(
    (select id from public.invoices where client_request_id = 'req-membego-cubierto-1'),
    'visita-1', 'plan-gold', v_precio, null);

  perform test.check('el canje confirmado anota lo que puso la membresía',
    v_inv.membego_covered_cents = v_precio,
    format('membego=%s precio=%s', v_inv.membego_covered_cents, v_precio));
  perform test.check('y deja la factura marcada como canjeada',
    v_inv.membego_canje_estado = 'canjeado', v_inv.membego_canje_estado::text);
end $$;

-- ── El canje lo anota el CAJERO, que es quien cobra ─────────────────────────
-- La única política de UPDATE sobre facturas exige rol gerencial, así que estas
-- dos funciones no podían escribir con la sesión de un cajero: el canje
-- reventaba con un error sobre la bitácora y la reversión mentía diciendo que
-- sí. Ningún cliente perdía su lavado, que es lo que lo hacía invisible: la
-- factura salía en 0 igual y la membresía nunca se descontaba.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;

select test.check('un cajero puede revertir lo que él mismo canjeó',
  (select membego_canje_estado = 'revertido' from public.record_membego_reversal(
     (select id from public.invoices where client_request_id = 'req-membego-cubierto-1'))));

-- Un rol que no cobra no anota canjes: `security definer` quita la RLS de en
-- medio, así que el candado tiene que estar dentro de la función.
set role postgres;
select set_config('request.jwt.claim.sub', test.var('op1'), false);
set role authenticated;
select test.expect_error('un operario no puede anotar un canje de Membego',
  format($q$select public.record_membego_redemption(%L::uuid, 'v9', 'plan', 1000, null)$q$,
         (select id from public.invoices where client_request_id = 'req-membego-cubierto-2')));

set role postgres;
select set_config('request.jwt.claim.sub', test.var('u_cashier_a'), false);
set role authenticated;
