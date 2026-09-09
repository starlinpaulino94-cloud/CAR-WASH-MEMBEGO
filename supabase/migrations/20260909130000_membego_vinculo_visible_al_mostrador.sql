-- =============================================================================
-- EL VÍNCULO CON MEMBEGO LO PUEDE LEER TODO EL MOSTRADOR
-- =============================================================================
-- SÍNTOMA
--
-- Un cajero abre la ficha de un cliente con membresía y le sale:
--
--     «Membego no respondió (Su empresa no es la vinculada a este local.)»
--
-- Al propietario no le pasa. Y el vínculo está bien puesto.
--
-- CAUSA
--
-- El guard de los bordes de Membego (api/_membego/auth.ts) hace tres preguntas.
-- La tercera —«¿es de ESTA empresa?»— lee `membego_company_links` CON EL TOKEN
-- DE QUIEN LLAMA, bajo RLS. Y la política de lectura de esta tabla exigía,
-- además de ser del tenant, tener rol propietario/administrador/superadmin.
--
-- Así que a un cajero la consulta le devuelve CERO FILAS. No un error: cero
-- filas, que es como RLS dice «esto no es tuyo». El guard no puede distinguir
-- «no tienes permiso para leerlo» de «tu empresa es otra», y responde lo
-- segundo. El mensaje era exacto sobre lo que el código veía y falso sobre lo
-- que pasaba, que es la peor combinación para quien intenta arreglarlo.
--
-- POR QUÉ SE QUITA EL FILTRO POR ROL Y NO SE LE AÑADEN DOS ROLES MÁS
--
-- Porque el filtro estaba en el sitio equivocado, y añadir roles a mano deja la
-- misma trampa armada para el siguiente rol que se sume al mostrador.
--
-- Esta fila dice UNA cosa: con qué empresa de Membego está vinculada la empresa
-- de quien pregunta. No es un dato de nadie más —`belongs_to_tenant` ya la
-- acota al propio tenant, y la tabla tiene `company_id` como clave primaria, así
-- que como mucho se lee una fila: la suya—. Las tablas hermanas que sí llevan
-- datos de clientes, `memberships` y `customer_promotions`, se leen desde 0014
-- con `belongs_to_tenant` a secas. Guardar el identificador de la integración
-- con más celo que las membresías que ese identificador sirve para consultar no
-- protegía nada.
--
-- Quién puede OPERAR se decide donde corresponde: en el paso 2 del guard (rol
-- de mostrador) y en el gate de `membego_link_company`, que sigue exigiendo
-- propietario o administrador para CAMBIAR el vínculo. Esto solo es lectura.
-- =============================================================================

drop policy if exists membego_company_links_select on public.membego_company_links;

create policy membego_company_links_select on public.membego_company_links
  for select to authenticated
  using (app.belongs_to_tenant(company_id));

comment on table public.membego_company_links is
  'Mapa empresa de Membego ↔ empresa de aquí. Lectura: cualquier empleado del '
  'tenant (el guard de api/_membego/auth.ts la necesita para comprobar que quien '
  'llama es de ESTE local). Escritura: solo membego_link_company().';
