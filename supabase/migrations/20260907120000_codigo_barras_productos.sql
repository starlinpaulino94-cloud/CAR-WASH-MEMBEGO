-- ============================================================================
-- 0043 · CÓDIGO DE BARRAS AUTOMÁTICO PARA LOS PRODUCTOS
--
-- `products.barcode` existía desde el principio pero nadie lo llenaba: solo la
-- importación lo traía, y los productos creados a mano quedaban sin él. Sin un
-- código no se puede etiquetar el estante ni pasar el lector en caja, que es
-- justo para lo que sirve la columna.
--
-- A partir de aquí, TODO producto nace con su código de barras.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EN LA BASE Y NO EN LA PANTALLA
--
-- Porque «automáticamente» tiene que valer para todas las puertas: el formulario
-- de productos, la importación masiva, un arreglo por SQL y lo que se añada
-- mañana. Generarlo en el navegador dejaría sin código a los productos que
-- entren por cualquier otra vía, y además dos cajeros creando a la vez podrían
-- sacar el mismo número. Una secuencia dentro de la transacción no puede
-- repetirse ni aunque el mundo entero inserte a la vez.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EMPIEZAN POR 2
--
-- El 2 es el rango que GS1 reserva para el USO INTERNO de un comercio. Es la
-- decisión importante de todo esto: un EAN-13 inventado con otro prefijo puede
-- chocar con el de un producto real de otro fabricante, y entonces el lector
-- diría que una fragancia es un yogur. Con el 2 nadie más los emite, así que
-- estos códigos no colisionan con nada del mundo — a cambio de que solo valen
-- dentro del negocio, que es exactamente para lo que se quieren.
--
-- El dígito verificador no es adorno: es lo que hace que un escaneo mal leído
-- se descarte en vez de cobrar otro producto.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LO QUE SE ESCRIBE A MANO SE RESPETA
--
-- Si el producto ya trae código —el del fabricante, pegado en el envase— se
-- conserva tal cual. Solo se genera cuando viene vacío: el código del envase es
-- mejor que cualquiera que inventemos, porque ya está impreso en el producto.
-- ============================================================================

-- ------------------------------------------------------ Dígito verificador
create or replace function app.ean13_digito_verificador(p_doce text)
returns integer
language plpgsql
immutable
as $$
declare
  v_suma integer := 0;
  i      integer;
begin
  if p_doce !~ '^[0-9]{12}$' then
    raise exception 'ean13: se requieren 12 dígitos, llegó "%"', p_doce;
  end if;
  -- Pesos alternos 1 y 3 de izquierda a derecha (substr es 1-indexado, así que
  -- las posiciones impares llevan peso 1).
  for i in 1..12 loop
    v_suma := v_suma
      + substr(p_doce, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
  end loop;
  return (10 - (v_suma % 10)) % 10;
end;
$$;

comment on function app.ean13_digito_verificador is
  'Dígito verificador EAN-13 a partir de los 12 primeros dígitos.';

-- ------------------------------------------------------------- Secuencia
-- Global, no por empresa: así dos empresas del mismo despliegue nunca comparten
-- un número y el código sigue siendo único aunque un producto cambie de dueño.
create sequence if not exists app.productos_barcode_seq;

grant usage on sequence app.productos_barcode_seq to authenticated, service_role;

-- --------------------------------------------------- Generador de códigos
create or replace function app.nuevo_barcode_producto()
returns text
language plpgsql
as $$
declare
  v_doce text;
begin
  -- '2' (uso interno) + 11 dígitos de secuencia = 12; el 13.º es el verificador.
  v_doce := '2' || lpad(nextval('app.productos_barcode_seq')::text, 11, '0');
  return v_doce || app.ean13_digito_verificador(v_doce)::text;
end;
$$;

comment on function app.nuevo_barcode_producto is
  'Genera un EAN-13 de uso interno (prefijo 2) único para un producto.';

-- ---------------------------------------------------------------- Trigger
create or replace function app.products_barcode_auto()
returns trigger
language plpgsql
as $$
begin
  -- Vacío o nulo → se genera. Con valor → se respeta (solo se limpia el
  -- espacio en blanco, que es lo que deja un copiar-pegar del proveedor).
  if new.barcode is null or btrim(new.barcode) = '' then
    new.barcode := app.nuevo_barcode_producto();
  else
    new.barcode := btrim(new.barcode);
  end if;
  return new;
end;
$$;

-- También en UPDATE: si alguien vacía el campo al editar, el producto no se
-- queda sin código — se le repone. La invariante es «todo producto tiene uno».
drop trigger if exists products_barcode_auto on public.products;
create trigger products_barcode_auto
  before insert or update of barcode on public.products
  for each row execute function app.products_barcode_auto();

-- ------------------------------------------------- Duplicados heredados
-- Antes de imponer la unicidad hay que poder imponerla: si una importación dejó
-- códigos repetidos, se conserva el más antiguo y los demás se regeneran. Sin
-- esto el índice de abajo haría fallar la migración en una base real.
with repetidos as (
  select id,
         row_number() over (
           partition by company_id, barcode order by created_at, id
         ) as n
    from public.products
   where barcode is not null and btrim(barcode) <> ''
)
update public.products p
   set barcode = app.nuevo_barcode_producto()
  from repetidos r
 where p.id = r.id and r.n > 1;

-- ------------------------------------------------------ Relleno histórico
-- Los productos que ya existían también quedan etiquetables.
update public.products
   set barcode = app.nuevo_barcode_producto()
 where barcode is null or btrim(barcode) = '';

-- --------------------------------------------------------------- Unicidad
-- Dos productos con el mismo código son dos productos que el lector no puede
-- distinguir: en caja saldría siempre el mismo. Por empresa, porque cada
-- negocio etiqueta lo suyo.
create unique index if not exists products_barcode_company_uidx
  on public.products (company_id, barcode)
  where barcode is not null;

-- Búsqueda por código al pasar el lector en caja.
create index if not exists products_barcode_idx
  on public.products (barcode)
  where barcode is not null;
