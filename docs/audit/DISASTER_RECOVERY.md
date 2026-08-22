# DISASTER_RECOVERY — Recuperación ante desastres

> Fases 25-26 de la auditoría. Qué hacer cuando algo se rompe en producción.
> El **mecanismo** de restauración está probado (`supabase/tests/restore.sh`,
> 7/7). La **ejecución** contra producción es del dueño; aquí está el runbook.

## Objetivos (RPO / RTO)

| Métrica | Objetivo | Base |
|---|---|---|
| **RPO** (cuánto dato se puede perder) | ≤ 24 h con el plan gratuito de Supabase; ≤ 2 min con PITR (plan Pro) | Supabase hace backup diario automático; el Point-in-Time Recovery del plan Pro baja el RPO a minutos |
| **RTO** (cuánto se tarda en volver) | ≤ 1 h | Restaurar un backup de Supabase + redeploy de Vercel |

**Recomendación:** para un negocio que factura (NCF fiscales, caja), el plan
gratuito con RPO de 24 h es arriesgado — perder un día de facturación es perder
dinero y romper la correlatividad fiscal. Evaluar el plan Pro con PITR.

## Qué se respalda y dónde

| Activo | Dónde vive | Respaldo |
|---|---|---|
| Base de datos (todo) | Supabase PostgreSQL | Backup automático de Supabase (diario / PITR) |
| Código | GitHub (`main`) | El repositorio ES el respaldo; reproducible |
| Esquema | 46 migraciones versionadas | Reconstruible desde cero (`supabase/tests/run.sh` lo prueba) |
| Secretos | Variables de entorno de Vercel | **No están respaldados en ningún sitio versionado** (a propósito). Anotarlos en un gestor de secretos del dueño |

## El mecanismo de restauración está probado

`supabase/tests/restore.sh` demuestra el ciclo completo contra el arnés:
respalda una base poblada con `pg_dump -Fc`, la restaura en una base limpia con
`pg_restore`, y verifica que coinciden las 56 tablas, 124 políticas RLS, 196
funciones, 217 índices y los datos — y que **la RLS sigue ENABLE+FORCE tras el
restore** (el candado de seguridad no se pierde). Si el mecanismo fallara,
fallaría aquí primero.

## Procedimiento: restaurar la base (RTO ≤ 1 h)

1. **No entrar en pánico ni escribir en la base dañada.** Un restore parte de un
   backup; escribir encima complica el punto de recuperación.
2. En el panel de Supabase → Database → Backups: elegir el backup (o el punto en
   el tiempo con PITR) inmediatamente anterior al incidente.
3. Restaurar. Supabase reconstruye el proyecto. Anotar la hora del punto elegido
   — todo lo posterior a ese punto se perdió (ese es el RPO real del incidente).
4. Verificar con la consulta de salud (abajo): las 4 cifras deben cuadrar.
5. Si cambió la URL/credenciales del proyecto, actualizar las variables en Vercel
   y **redeploy**.
6. Confirmar en el POS: emitir una factura de prueba y anularla.

### Consulta de salud post-restore (solo lectura)

```sql
select 'tablas'    as pieza, count(*) from pg_tables where schemaname='public'
union all select 'políticas RLS', count(*) from pg_policies where schemaname='public'
union all select 'tablas sin FORCE (debe ser 0)',
  count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity
union all select 'última factura', count(*) from public.invoices;
```

## Procedimiento: rollback de un despliegue malo en Vercel (Fase 29)

Vercel despliega `main` solo. Si un deploy rompe producción:

1. **Rollback instantáneo (segundos):** Vercel → proyecto → Deployments →
   el último deploy bueno → «Promote to Production» (o «Instant Rollback»).
   Esto NO toca el código en git; solo reapunta el tráfico al build anterior.
2. **Arreglar la causa en git:** `git revert <commit malo>` en una rama,
   PR, CI verde, merge. El revert es preferible a `reset` porque deja historia.
3. Con el CI (Phase 1) esto es raro: un build roto o un typecheck fallido ya no
   llega a `main`.

> Regla de la auditoría: si la respuesta a «¿cómo volvemos?» fuera «pedirle a la
> IA que lo arregle», el proyecto no estaría listo. La respuesta ahora es
> concreta: Instant Rollback en Vercel + revert en git.

## Escenarios (Fase 26)

| Escenario | Respuesta |
|---|---|
| **Base de datos caída/corrupta** | Restaurar backup de Supabase (arriba). RTO ≤ 1 h. |
| **Deploy rompe producción** | Instant Rollback en Vercel + revert en git. Minutos. |
| **Proveedor (Supabase) caído** | Esperar; no hay multi-región en el plan actual. La SPA muestra el ErrorBoundary. Evaluar réplica si el SLA lo exige. |
| **Proveedor (Vercel) caído** | El código es portable (build estático + funciones); se puede desplegar en otro host. Poco probable que aporte antes que la recuperación de Vercel. |
| **Credenciales comprometidas** | Ver playbook abajo. |
| **Corrupción de datos por bug** | PITR al instante anterior al bug (plan Pro), o restaurar el backup diario y reaplicar lo recuperable. |

## Playbook: credenciales comprometidas

Si se filtra un secreto (service_role, MEMBEGO_CLIENT_SECRET, MEMBEGO_SECRETO):

1. **Supabase service_role / anon:** rotar las claves en Supabase → Settings →
   API. Actualizar las variables en Vercel y redeploy.
2. **MembeGo (`MEMBEGO_CLIENT_SECRET`):** la credencial es rotable por diseño —
   pedir una nueva (o regenerar el SQL de registro), revocar la vieja en
   `credenciales_sistema`, actualizar Vercel, redeploy.
3. **MEMBEGO_SECRETO (webhooks):** rotar en el vínculo del sistema; los webhooks
   con la firma vieja dejarán de validar (correcto).
4. Revisar `audit_logs` y los logs estructurados por actividad anómala en la
   ventana de exposición.

## Lo que falta (honesto)

- **Ejecutar un restore real** en un proyecto de staging de Supabase: el
  mecanismo está probado, pero un simulacro contra el backup real de producción
  solo lo puede hacer el dueño. Recomendado hacerlo una vez para cronometrar el
  RTO real.
- **PITR**: requiere plan Pro; hoy el RPO depende del backup diario.
- **Automatizar la verificación de salud** post-restore como alerta.
