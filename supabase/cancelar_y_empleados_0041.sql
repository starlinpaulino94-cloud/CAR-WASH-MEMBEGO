-- ============================================================================
-- PARCHE 0041 · cancelar órdenes · eliminar empleados
--
-- Para correr suelto en el SQL Editor de Supabase, DESPUÉS de borrado_0040.sql
-- (usa `app.registrar_borrado`, que lo crea 0040). Repetible sin daño.
-- ============================================================================
-- ============================================================================
-- 0041 · CANCELAR UNA ORDEN DE TRABAJO · ELIMINAR UN EMPLEADO
--
-- Las dos piezas que quedaron fuera de 0040 porque cada una tenía su propia
-- decisión que tomar, y ninguna era «añadir un GRANT».
-- ============================================================================


-- ############################################################################
-- PARTE A · CANCELAR UNA ORDEN DE TRABAJO
--
-- El estado `cancelado` YA existía en el enum, y `app.order_transition_allowed`
-- YA permitía llegar a él desde pendiente, en_espera, asignada, en_proceso y
-- control_calidad. Lo que no existía era forma de usarlo: ni motivo, ni quién,
-- ni cuándo, ni un botón. Una orden mal registrada se quedaba en el tablero.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LO QUE NO HAY QUE DESHACER, Y POR QUÉ
--
-- Un lector futuro se va a preguntar si cancelar tiene que devolver insumos y
-- anular comisiones. No: las dos cosas ocurren SOLO al pasar a `entregado`
-- (`app.consume_recipes` y el reparto de comisiones viven en esa rama de
-- `advance_work_order`), y `entregado` es terminal — no se puede cancelar.
--
-- Así que una orden cancelada nunca consumió inventario ni generó comisión, y
-- no hay nada que revertir. Si algún día se permite cancelar una orden ya
-- entregada, esto deja de ser cierto y hay que revisarlo aquí.
--
-- La bahía sí se libera, y de eso ya se encarga `advance_work_order` al salir
-- de `en_proceso`; esta función pasa por ahí en vez de escribir el estado a
-- mano, para no tener dos sitios que liberen bahías con reglas distintas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA GUARDA QUE DE VERDAD HACE FALTA
--
-- `fetchChargeableOrders` ofrece al cobro cualquier orden con `payment_status`
-- pendiente que no esté cancelada — incluida una en `en_proceso`. O sea: se
-- puede facturar una orden a medio lavar y DESPUÉS cancelarla. Eso deja una
-- factura emitida, con su NCF, apuntando a un lavado que el sistema dice que
-- nunca ocurrió.
--
-- Se prohíbe. Si hay factura, primero se anula la factura —que emite su nota de
-- crédito— y después se cancela la orden.
-- ############################################################################

alter table public.work_orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.profiles(id) on delete set null;

comment on column public.work_orders.cancel_reason is
  'Por qué se canceló. Obligatorio: una orden que desaparece del tablero sin motivo es una discusión que nadie puede resolver una semana después.';

-- Índice PARCIAL: las canceladas se consultan para revisarlas («¿por qué se
-- cayeron cinco lavados ayer?») y son una minoría frente a todas las órdenes.
create index if not exists work_orders_canceladas_idx
  on public.work_orders (company_id, cancelled_at desc)
  where status = 'cancelado';

create or replace function public.cancel_work_order(
  p_order_id uuid,
  p_reason   text
)
returns public.work_orders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_company  uuid := app.current_company_id();
  v_order    public.work_orders;
  v_facturas integer;
  v_result   public.work_orders;
begin
  if v_company is null then
    raise exception 'El usuario no tiene empresa asignada' using errcode = 'insufficient_privilege';
  end if;

  -- Cancelar un lavado no es una operación de mostrador: borra trabajo del
  -- tablero y descuadra el conteo del día. Mismos roles que anular una factura,
  -- que es la operación correctiva equivalente.
  if not app.has_role('propietario', 'administrador', 'supervisor', 'superadmin') then
    raise exception 'Su rol no permite cancelar órdenes de trabajo'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'Explique por qué se cancela la orden (mínimo 5 caracteres)'
      using errcode = 'invalid_parameter_value';
  end if;

  -- FOR UPDATE: dos supervisores cancelando la misma tarjeta a la vez.
  select * into v_order from public.work_orders
   where id = p_order_id and company_id = v_company
   for update;

  if v_order.id is null then
    raise exception 'Orden inexistente o fuera de su alcance' using errcode = 'no_data_found';
  end if;

  if v_order.status = 'cancelado' then
    -- Ya estaba. No es un error: es la respuesta correcta a un segundo clic.
    return v_order;
  end if;

  if v_order.status = 'entregado' then
    raise exception 'La orden % ya se entregó: no se puede cancelar', v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- `listo` no admite cancelación en la máquina de estados, y tiene sentido: el
  -- carro está lavado y esperando a que lo recojan. El trabajo ya se hizo. Sin
  -- este mensaje, el usuario vería el «no se puede pasar de listo a cancelado»
  -- del guardián de transiciones, que no le dice qué hacer.
  if v_order.status = 'listo' then
    raise exception
      'La orden % ya está lavada y lista para entregar: el trabajo se hizo. Entréguela y, si no se cobra, anule la factura.',
      v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- La guarda de la factura. Va antes de tocar nada.
  select count(*) into v_facturas from public.invoices
   where work_order_id = p_order_id and company_id = v_company and not is_annulled;

  if v_facturas > 0 then
    raise exception
      'La orden % ya está facturada. Anule primero la factura —se emite su nota de crédito— y después cancele la orden.',
      v_order.order_number
      using errcode = 'check_violation';
  end if;

  -- El motivo se sella ANTES del cambio de estado: `advance_work_order` dispara
  -- el guardián de transiciones, y si por lo que sea rechaza, la transacción
  -- entera rueda atrás y no queda un motivo sin cancelación que lo respalde.
  update public.work_orders
     set cancel_reason = left(trim(p_reason), 500),
         cancelled_at  = now(),
         cancelled_by  = auth.uid()
   where id = p_order_id;

  -- Por `advance_work_order` y no a mano: es quien sabe liberar la bahía, y dos
  -- sitios liberando bahías acaban discrepando.
  v_result := public.advance_work_order(p_order_id, 'cancelado');

  insert into public.audit_logs (company_id, branch_id, action, entity, entity_id, details)
  values (v_company, v_order.branch_id, 'CANCELAR_ORDEN', 'WorkOrder', p_order_id::text,
          'Orden ' || v_order.order_number || ' cancelada desde "' || v_order.status ||
          '": ' || left(trim(p_reason), 200));

  return v_result;
end;
$$;

revoke all on function public.cancel_work_order(uuid, text) from public;
grant execute on function public.cancel_work_order(uuid, text) to authenticated;

comment on function public.cancel_work_order is
  'Cancela una orden con motivo obligatorio. Rechaza las ya facturadas: primero se anula la factura. Libera la bahía a través de advance_work_order.';


-- ############################################################################
-- PARTE B · ELIMINAR UN EMPLEADO
--
-- Quitar el acceso ya se podía (Configuración › Usuarios y roles, «Quitar
-- acceso», que apaga `is_active`). Lo que no se podía era eliminar la ficha: un
-- empleado dado de alta con el correo mal escrito se quedaba en la lista para
-- siempre, marcado «sin acceso», estorbando.
--
-- ────────────────────────────────────────────────────────────────────────────
-- EN LA PRÁCTICA, SOLO SE BORRA A QUIEN NUNCA TRABAJÓ
--
-- Y es lo correcto. El guardián incluye `audit_logs`, así que basta UNA acción
-- registrada para que la ficha ya no se pueda borrar. Suena estricto hasta que
-- se piensa al revés: si esa persona cobró una factura, su nombre tiene que
-- seguir en esa factura. La alternativa —`audit_logs.actor_id` es SET NULL— era
-- borrar la ficha y dejar la bitácora diciendo que aquello lo hizo nadie.
--
-- Quien trabajó se desactiva. Quien nunca existió de verdad se borra.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LAS DOS GUARDAS QUE IMPORTAN MÁS QUE EL HISTORIAL
--
--   1. NADIE SE BORRA A SÍ MISMO. Un administrador que borra su propia ficha se
--      queda fuera en el acto, y sin ficha no hay forma de volver a entrar a
--      arreglarlo.
--   2. NO SE BORRA AL ÚLTIMO QUE MANDA. Si se elimina al único propietario o
--      administrador activo, la empresa se queda sin nadie que pueda
--      administrarla —incluido crear otro administrador—. Es un bloqueo
--      permanente, y desde dentro del sistema no tiene arreglo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA CREDENCIAL NO SE VA CON LA FICHA
--
-- `auth.users` no se toca desde aquí: hace falta service_role y esto corre con
-- el token del propio administrador. Borrada la ficha, esa cuenta puede seguir
-- autenticándose pero NO VE NADA —`app.belongs_to_tenant` es falso sin empresa,
-- y la aplicación la deja en la pantalla de «cuenta sin configurar»—.
--
-- Para que la credencial desaparezca de verdad hay que borrar el usuario en el
-- panel de Supabase (Authentication › Users). La interfaz lo dice al confirmar:
-- dejar creer que la persona quedó fuera del todo sería peor que no ofrecerlo.
-- ############################################################################

-- El candado del rol, RESTRICTIVE como en 0040: solo puede restringir.
drop policy if exists profiles_borrar_solo_admin on public.profiles;
create policy profiles_borrar_solo_admin on public.profiles
  as restrictive for delete to authenticated
  using (app.has_role('propietario', 'administrador', 'superadmin'));

grant delete on public.profiles to authenticated;

create or replace function app.frenar_borrado_de_empleado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cuenta bigint;
  v_jefes  bigint;
begin
  -- 1 · Nadie se borra a sí mismo.
  if OLD.id = auth.uid() then
    raise exception 'No puede eliminar su propia ficha: se quedaría fuera del sistema en el acto'
      using errcode = 'check_violation';
  end if;

  -- 2 · No se borra al último que manda.
  if OLD.role in ('propietario', 'administrador') and OLD.is_active then
    select count(*) into v_jefes from public.profiles
     where company_id = OLD.company_id
       and role in ('propietario', 'administrador')
       and is_active
       and id <> OLD.id;

    if v_jefes = 0 then
      raise exception
        'Es el único administrador activo de la empresa. Nombre otro antes de eliminarlo, o la empresa se queda sin quien la administre.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 3 · Quien trabajó no se borra, se desactiva.
  --
  -- `audit_logs` va primero porque es el que atrapa casi todo: cualquier acción
  -- registrada deja rastro ahí, y ese rastro debe conservar su autor.
  select count(*) into v_cuenta from public.audit_logs where actor_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: tiene % acciones registradas en la bitácora, y deben conservar su autor. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.invoices where cashier_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: emitió % facturas y su nombre tiene que seguir en ellas. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.commissions where profile_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: tiene % comisiones generadas. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.payroll_items where profile_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: entró en % liquidaciones de nómina. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.payroll_advances where profile_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: tiene % adelantos de nómina. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.cash_sessions where cashier_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: abrió % turnos de caja. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.work_order_assignees where profile_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: trabajó en % lavados. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_cuenta from public.attendance_records where profile_id = OLD.id;
  if v_cuenta > 0 then
    raise exception
      'No se puede eliminar: tiene % marcajes de asistencia. Quítele el acceso en vez de borrarlo.',
      v_cuenta using errcode = 'foreign_key_violation';
  end if;

  return OLD;
end;
$$;

comment on function app.frenar_borrado_de_empleado is
  'Impide borrarse a sí mismo, borrar al último administrador, y borrar a quien ya trabajó. Lo tercero se explica contando: «emitió 12 facturas».';

drop trigger if exists profiles_frenar_borrado on public.profiles;
create trigger profiles_frenar_borrado before delete on public.profiles for each row
  execute function app.frenar_borrado_de_empleado();

drop trigger if exists profiles_registrar_borrado on public.profiles;
create trigger profiles_registrar_borrado after delete on public.profiles for each row
  execute function app.registrar_borrado();
