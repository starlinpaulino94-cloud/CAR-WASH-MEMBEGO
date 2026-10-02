-- =============================================================================
-- UNA NOTA DE CRÉDITO NO ES UNA VENTA, Y UNA ORDEN NO SE COBRA DOS VECES
--
-- DOS SÍNTOMAS, EN PALABRAS DEL DUEÑO:
--
--   «en los reportes está apareciendo que mi usuario cobró dinero pero mi
--    usuario no ha hecho nada de eso»
--   «hay facturas que se están duplicando»
--
-- Son dos fallos distintos. Los dos salen aquí.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · LA VENTA QUE SE LE ATRIBUYE A QUIEN SOLO ANULÓ
--
-- Anular una factura emite una NOTA DE CRÉDITO, que se guarda como una fila más
-- de `invoices` apuntando con `credits_invoice_id` a la factura que anula. Esa
-- fila la firma quien anuló —normalmente el dueño o un administrador, porque un
-- cajero no puede anular—.
--
-- Los informes gerenciales descartan las notas de crédito así:
--
--     and i.ncf_type is distinct from 'B04'
--
-- Y `ncf_type` solo se pone cuando la factura original llevaba NCF:
--
--     case when v_ncf is not null then 'B04'::app.ncf_type else null end
--
-- O sea: al anular un RECIBO INTERNO —una venta sin NCF, que es la mayoría— la
-- nota nace con `ncf_type` en nulo, el filtro no la reconoce y el informe la
-- cuenta como una VENTA MÁS. Peor: la original queda anulada y desaparece del
-- informe «vigente», así que la venta no se duplica, se MUDA — del cajero que
-- cobró a quien anuló. Misma placa, mismo importe, otro nombre. Exactamente lo
-- que se veía en pantalla:
--
--     Ventas de <el dueño> · 1 factura · FAC-00000143 · G312036 · RD$ 800.00
--
-- Y en el informe de rentabilidad sale dos veces mal: la nota suma como venta y
-- además no se resta en el renglón de notas de crédito, que busca el mismo
-- 'B04' que no está.
--
-- POR QUÉ NO LO ATAJÓ EL CANDADO QUE YA EXISTÍA
--
-- Había una restricción puesta justo para esto:
--
--     check ((credits_invoice_id is null) or (ncf_type = 'B04'))
--
-- Con `credits_invoice_id` lleno y `ncf_type` nulo, eso es `false or NULL`, que
-- en SQL vale NULL — y un CHECK solo rechaza cuando vale FALSE. Aceptaba en
-- silencio justo la fila que existía para prohibir. El candado estaba puesto y
-- la puerta abierta.
--
-- EL ARREGLO
--
-- Una nota de crédito es B04 lleve NCF o no: el tipo dice QUÉ es el documento,
-- no si se le asignó número fiscal (el número vive en `ncf`, que sigue nulo
-- cuando no hay rango). Con eso, los filtros que ya hay en los seis informes
-- vuelven a acertar sin tocarlos uno a uno — y no quedan dos formas distintas
-- de preguntar «¿esto es una nota de crédito?» dando respuestas diferentes, que
-- es de donde salió el fallo.
--
-- Se hace con un trigger y no parcheando las tres funciones que insertan notas,
-- por lo mismo que se razonó con el rol en 20260922140000: una lista de sitios
-- que mantener a mano se queda desfasada en el primer camino nuevo. Y la
-- restricción se rehace en dos valores para que vuelva a prohibir de verdad.
--
-- Lo ya emitido se corrige: mientras esas filas sigan sin tipo, los informes de
-- los meses pasados siguen contando como ventas lo que fueron devoluciones.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · LA MISMA ORDEN, COBRADA DOS VECES
--
-- `create_invoice` es idempotente por `client_request_id`: dos clics sobre
-- «Cobrar» devuelven la misma factura. Pero esa clave es del INTENTO, no del
-- lavado. Dos pestañas, dos dispositivos, o la misma pantalla tras recargar,
-- traen claves distintas — y entonces la orden se factura otra vez: segundo
-- comprobante, segundo descuento de stock, segundo ingreso en caja.
--
-- La pantalla ya filtra las órdenes cobradas, pero la lista es una foto: si dos
-- cajeros la abrieron antes de que ninguno cobrara, los dos ven la orden y los
-- dos pueden cobrarla. Y una orden fiada ENTERA queda en estado «pendiente» a
-- propósito (lo pendiente es el pago, no el cobro), así que vuelve a la lista
-- ella sola. El servidor no lo comprobaba en ningún sitio.
--
-- Ahora sí: una orden no admite una segunda factura vigente. El candado va
-- sobre la fila de la orden (`for update`), que es lo que pone en fila a dos
-- cobros simultáneos; comprobar sin bloquear deja pasar a los dos. Si la
-- primera factura se anula, la orden vuelve a poder cobrarse — que es como se
-- arregla un cobro equivocado.
--
-- Reejecutable: drop trigger if exists + create or replace.
-- =============================================================================

-- ═══════════════════════════════════════ 1 · La nota de crédito se llama B04

create or replace function app.nota_de_credito_es_b04()
returns trigger
language plpgsql
as $$
begin
  -- Apunta a la factura que anula ⇒ es una nota de crédito ⇒ es B04, con NCF
  -- o sin él. El número fiscal, si lo hay, sigue viniendo de `ncf`.
  if new.credits_invoice_id is not null then
    new.ncf_type := 'B04';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_nota_es_b04 on public.invoices;
create trigger invoices_nota_es_b04
  before insert or update of credits_invoice_id, ncf_type on public.invoices
  for each row execute function app.nota_de_credito_es_b04();

-- Lo ya emitido, antes de apretar la restricción: son las notas de crédito de
-- recibos internos que los informes llevan contando como ventas.
update public.invoices
   set ncf_type = 'B04'
 where credits_invoice_id is not null
   and ncf_type is distinct from 'B04';

-- El candado, ahora en dos valores: con `ncf_type` nulo la versión anterior
-- daba NULL y el CHECK dejaba pasar la fila.
alter table public.invoices
  drop constraint if exists invoices_credit_note_is_coherent;

alter table public.invoices
  add constraint invoices_credit_note_is_coherent check (
    credits_invoice_id is null or ncf_type is not distinct from 'B04'
  );

-- ═══════════════════════════════════════ 2 · Una factura vigente por orden

create or replace function app.una_factura_por_orden()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_otra text;
begin
  -- Las notas de crédito heredan la orden de su original a propósito: no son
  -- un segundo cobro. Y las facturas de flota no cuelgan de ninguna orden.
  if new.work_order_id is null or new.credits_invoice_id is not null then
    return new;
  end if;

  -- El candado va en la ORDEN: dos cobros a la vez se ponen en fila aquí, y el
  -- segundo ya ve la factura del primero. Sin esto, los dos miran una tabla en
  -- la que todavía no hay nada y los dos insertan.
  perform 1 from public.work_orders
   where id = new.work_order_id and company_id = new.company_id
   for update;

  select i.invoice_number into v_otra
    from public.invoices i
   where i.work_order_id = new.work_order_id
     and i.company_id = new.company_id
     and i.credits_invoice_id is null
     and not i.is_annulled
   limit 1;

  if v_otra is not null then
    raise exception
      'Esa orden ya se facturó (%). Si hay que rehacerla, anule esa factura primero.', v_otra
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_una_por_orden on public.invoices;
create trigger invoices_una_por_orden
  before insert on public.invoices
  for each row execute function app.una_factura_por_orden();

comment on constraint invoices_credit_note_is_coherent on public.invoices is
  'Una nota de crédito es siempre B04, lleve NCF o no. Escrito en dos valores: '
  'la versión anterior daba NULL con ncf_type nulo y el CHECK no rechazaba.';
