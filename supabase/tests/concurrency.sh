#!/usr/bin/env bash
# Pruebas de CONCURRENCIA reales (BL-001 / TEST-003 de la auditoría).
#
# No basta un usuario: hay recursos que dos cajeros pueden disputar a la vez.
# Estas pruebas abren DOS transacciones solapadas de verdad (dos procesos psql)
# y comprueban que los candados de la base serializan como deben:
#
#   1. NCF   — dos facturas simultáneas NUNCA reciben el mismo número fiscal.
#   2. Bahía — dos operarios no pueden ocupar la misma bahía con dos órdenes.
#   3. Stock — dos ventas simultáneas dejan la aritmética exacta (sin lost update).
#
# Construye su propia base para ser reproducible en CI. Habla por PGHOST
# (socket local por defecto, TCP en CI).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGPORT:-5433}"
HOST="${PGHOST:-/tmp}"
DB=membego_concurrency
PSQL=(psql -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
Q=(psql -h "$HOST" -p "$PORT" -U postgres -tA)

COMPANY='11111111-1111-1111-1111-111111111111'
BRANCH='22222222-2222-2222-2222-222222222222'
CASHIER='33333333-3333-3333-3333-333333333333'

echo "· construyendo base de prueba $DB"
"${PSQL[@]}" -tAc "drop database if exists $DB;" postgres >/dev/null
"${PSQL[@]}" -tAc "create database $DB;" postgres >/dev/null
"${PSQL[@]}" -d "$DB" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "FALLO migración $(basename "$f")"; exit 1; }
done
"${PSQL[@]}" -d "$DB" -f "$HERE/../../tests/e2e/seed.sql" >/dev/null 2>&1

fallos=0
paso() { echo "  PASA   $1"; }
fallo() { echo "  FALLA  $1"; fallos=$((fallos + 1)); }

# ══════════════════════════════════════════════════════════════════════════
# 1. NCF — dos allocate_ncf solapados deben dar valores DISTINTOS
# ══════════════════════════════════════════════════════════════════════════
# Sesión A toma el candado de la secuencia y lo retiene 2 s; B arranca a los
# 0,5 s y DEBE bloquearse hasta que A haga commit, saliendo con el siguiente.
cat > /tmp/conc_ncf_a.sql <<SQL
begin;
select app.allocate_ncf('$COMPANY','B02') as ncf;
select pg_sleep(2);
commit;
SQL
cat > /tmp/conc_ncf_b.sql <<SQL
begin;
select app.allocate_ncf('$COMPANY','B02') as ncf;
commit;
SQL

"${Q[@]}" -d "$DB" -f /tmp/conc_ncf_a.sql > /tmp/conc_ncf_a.out 2>&1 &
PIDA=$!
sleep 0.5
"${Q[@]}" -d "$DB" -f /tmp/conc_ncf_b.sql > /tmp/conc_ncf_b.out 2>&1 &
PIDB=$!
wait $PIDA; wait $PIDB

NCF_A=$(grep -oE 'B02[0-9]{8}' /tmp/conc_ncf_a.out | head -1)
NCF_B=$(grep -oE 'B02[0-9]{8}' /tmp/conc_ncf_b.out | head -1)
if [ -n "$NCF_A" ] && [ -n "$NCF_B" ] && [ "$NCF_A" != "$NCF_B" ]; then
  paso "dos facturas simultáneas reciben NCF distintos  [$NCF_A ≠ $NCF_B]"
else
  fallo "los NCF simultáneos colisionaron o faltaron  [A=$NCF_A B=$NCF_B]"
fi

# La secuencia avanzó exactamente 2, ni más ni menos.
NEXT=$("${Q[@]}" -d "$DB" -c "select next_value from ncf_sequences where company_id='$COMPANY' and ncf_type='B02'")
if [ "$NEXT" = "3" ]; then
  paso "la secuencia avanzó exactamente 2 (next_value=3)"
else
  fallo "la secuencia quedó en next_value=$NEXT (se esperaba 3)"
fi

# ══════════════════════════════════════════════════════════════════════════
# 2. BAHÍA — dos órdenes intentando ocupar la MISMA bahía a la vez
# ══════════════════════════════════════════════════════════════════════════
"${PSQL[@]}" -d "$DB" >/dev/null 2>&1 <<SQL
select set_config('app.branch_ctx','ok',true);
select set_config('request.jwt.claim.sub','$CASHIER',false);
-- una bahía libre y dos órdenes en cola
insert into public.bays (id, company_id, branch_id, name, status)
values ('b0000000-0000-0000-0000-0000000000b1','$COMPANY','$BRANCH','Bahía Conc','disponible'::app.bay_status)
on conflict (id) do update set status='disponible', current_work_order_id=null;
select public.create_work_order('$BRANCH','conc-o1','CONC-1','sedan'::app.vehicle_category,
  jsonb_build_array(jsonb_build_object('service_id','44444444-4444-4444-4444-444444444444','name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),'Cliente Conc 1');
select public.create_work_order('$BRANCH','conc-o2','CONC-2','sedan'::app.vehicle_category,
  jsonb_build_array(jsonb_build_object('service_id','44444444-4444-4444-4444-444444444444','name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),'Cliente Conc 2');
SQL

O1=$("${Q[@]}" -d "$DB" -c "select id from work_orders where client_request_id='conc-o1'")
O2=$("${Q[@]}" -d "$DB" -c "select id from work_orders where client_request_id='conc-o2'")
BAY='b0000000-0000-0000-0000-0000000000b1'

cat > /tmp/conc_bay_a.sql <<SQL
select set_config('request.jwt.claim.sub','$CASHIER',false);
begin;
select public.advance_work_order('$O1','en_proceso'::app.order_status,'$BAY',null);
select pg_sleep(2);
commit;
SQL
cat > /tmp/conc_bay_b.sql <<SQL
select set_config('request.jwt.claim.sub','$CASHIER',false);
begin;
select public.advance_work_order('$O2','en_proceso'::app.order_status,'$BAY',null);
commit;
SQL

"${Q[@]}" -d "$DB" -f /tmp/conc_bay_a.sql > /tmp/conc_bay_a.out 2>&1 &
PIDA=$!
sleep 0.5
"${Q[@]}" -d "$DB" -f /tmp/conc_bay_b.sql > /tmp/conc_bay_b.out 2>&1 &
PIDB=$!
wait $PIDA; wait $PIDB

# Exactamente UNA de las dos órdenes quedó en proceso en esa bahía.
EN_BAHIA=$("${Q[@]}" -d "$DB" -c "select count(*) from work_orders where bay_id='$BAY' and status='en_proceso'")
OCUP=$("${Q[@]}" -d "$DB" -c "select count(*) from work_orders where client_request_id in ('conc-o1','conc-o2') and status='en_proceso'")
if [ "$OCUP" = "1" ]; then
  paso "solo UNA orden ocupó la bahía; la otra fue rechazada  [en_proceso=$OCUP]"
else
  fallo "la bahía fue ocupada por $OCUP órdenes a la vez (doble reserva)"
fi

# ══════════════════════════════════════════════════════════════════════════
# 3. STOCK — dos decrementos simultáneos: aritmética exacta, sin lost update
# ══════════════════════════════════════════════════════════════════════════
PROD='55555555-5555-5555-5555-555555555555'
"${PSQL[@]}" -d "$DB" -c "update public.products set stock=10 where id='$PROD'" >/dev/null 2>&1
# Nota: el stock puede ser negativo POR DISEÑO (un descuadre debe verse). Lo que
# se prueba aquí es que no se pierde ningún decremento, no que se bloquee.
cat > /tmp/conc_stock.sql <<SQL
select set_config('request.jwt.claim.sub','$CASHIER',false);
begin;
set local app.inventory_ctx = '{"kind":"venta","reason":"conc","branch_id":"$BRANCH"}';
update public.products set stock = stock - 3 where id='$PROD';
select pg_sleep(1);
commit;
SQL
"${Q[@]}" -d "$DB" -f /tmp/conc_stock.sql > /tmp/conc_stock_a.out 2>&1 &
PIDA=$!
sleep 0.2
"${Q[@]}" -d "$DB" -f /tmp/conc_stock.sql > /tmp/conc_stock_b.out 2>&1 &
PIDB=$!
wait $PIDA; wait $PIDB
STOCK=$("${Q[@]}" -d "$DB" -c "select stock from products where id='$PROD'")
if [ "$STOCK" = "4" ]; then
  paso "dos ventas de 3 sobre 10 dejan 4, sin lost update  [stock=$STOCK]"
else
  fallo "la aritmética de stock se corrompió bajo concurrencia  [stock=$STOCK, se esperaba 4]"
fi

echo "════════════════════════════════════════"
if [ "$fallos" -eq 0 ]; then
  echo "CONCURRENCIA: todas las comprobaciones pasan."
else
  echo "CONCURRENCIA: $fallos comprobación(es) fallaron."
fi
"${PSQL[@]}" -tAc "drop database if exists $DB;" postgres >/dev/null 2>&1
exit "$fallos"
