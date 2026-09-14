-- ════════════════════════════════════════════════════════════════════
-- COMPROBAR QUE LAS CORRECCIONES LLEGARON A LA BASE
--
-- `npm run db:verificar` responde a «¿existe esta función?». Esta consulta
-- responde a otra pregunta, que es la que falla en la práctica: «¿la función
-- que existe es la NUEVA?». Una migración que se dio por aplicada sin aplicarse
-- deja el nombre en su sitio y el cuerpo viejo dentro, y entonces la primera
-- comprobación dice que sí y la pantalla sigue rota.
--
-- Por eso mira DENTRO: si `orders_page` todavía crea una tabla temporal, si
-- conoce la variable que arregló el filtro «Activas», y si las funciones del
-- canje son `security definer` —lo único que permite al cajero anotarlo—.
--
-- Solo lee. Pegar en Supabase → SQL Editor. Las cuatro filas deben decir «OK».
-- ════════════════════════════════════════════════════════════════════
select
  'Órdenes, Kardex, Calidad y Caja' as que_se_arregla,
  case when count(*) = 0 then 'OK'
       else 'FALTA: ' || string_agg(proname, ', ') end as estado
from pg_proc
where proname in ('orders_page','kardex_page','qc_history_page','cash_sessions_page')
  and prosrc ilike '%create temporary table%'

union all
select 'Filtro «Activas» en Órdenes',
  case when exists (select 1 from pg_proc
                     where proname = 'orders_page' and prosrc ilike '%v_status%')
       then 'OK' else 'FALTA: la migración 20260912120000 no llegó' end

union all
select 'El cajero puede anotar el canje',
  case when (select bool_and(prosecdef) from pg_proc
              where proname in ('record_membego_redemption','record_membego_reversal'))
       then 'OK' else 'FALTA: la migración 20260912130000 no llegó' end

union all
select 'Servicios que puede pagar una membresía',
  case when (select count(*) from public.services
              where included_in_membego and is_active) = 0
       then 'NINGUNO marcado: la caja cobrará completo a todos los socios'
       else 'OK · ' || (select string_agg(name, ', ') from public.services
                         where included_in_membego and is_active) end;
