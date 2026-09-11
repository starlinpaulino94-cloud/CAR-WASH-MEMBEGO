import {
  ErrorAuth,
  tokenDeLaPeticion,
  pasoSesion,
  pasoPerfil,
  pasoVinculo,
  empresaMembegoDelDespliegue,
  supabaseDelServidor,
  faltaConfiguracionAuth,
} from '../_membego/auth.js';
import {
  llamar,
  json,
  COMPANY_ID,
  faltaConfiguracion,
  hostApiMembego,
  probarCredencial,
  ErrorMembego,
} from '../_membego/cliente.js';

/**
 * Diagnóstico de la integración con Membego. SOLO LEE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Cuando el mostrador dice «da error al jalar el cliente», la causa puede ser
 * cualquiera de seis cosas muy distintas: una variable sin poner en Vercel, dos
 * proyectos de Supabase que no son el mismo, una sesión vencida, un rol que no
 * entra, una migración sin aplicar que esconde el vínculo, o Membego rechazando
 * la credencial. Todas se ven IGUAL desde la caja: un aviso amarillo.
 *
 * Hasta ahora la única forma de distinguirlas era leer los logs de Vercel, que
 * el dueño del lavadero no tiene ni tiene por qué tener. Este borde corre los
 * mismos pasos del guard, pero uno a uno y sin parar en el primero, y dice cuál
 * falla y qué hacer. Un fallo que se nombra solo se arregla en minutos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO CORRE EL QUE TIENE EL PROBLEMA
 *
 * No se restringe a propietarios a propósito. Dos de las causas (el rol y la
 * lectura del vínculo bajo RLS) DEPENDEN DE QUIÉN LLAMA: el dueño puede tener
 * todo verde mientras al cajero le falla. Un diagnóstico que solo el dueño
 * puede correr no ve el problema del cajero, y entonces no sirve para nada.
 *
 * Lo único que hace falta para correrlo es una sesión válida de Supabase de
 * este mismo despliegue (paso «sesion»). Lo que devuelve es configuración del
 * propio local —nombres de variables presentes o ausentes, el host de la API,
 * el id de empresa de Membego que el propietario escribió a mano en Ajustes—,
 * nunca un secreto: `MEMBEGO_CLIENT_SECRET`, la `service_role` y el token de
 * nadie no aparecen aquí ni en forma parcial.
 */

type Estado = 'ok' | 'falla' | 'aviso' | 'omitido';

interface Paso {
  clave: string;
  titulo: string;
  estado: Estado;
  detalle: string;
  /** Qué hacer. Vacío cuando no hay nada que hacer. */
  arreglo?: string;
}

interface Cuerpo {
  /**
   * `VITE_SUPABASE_URL` tal como la ve el NAVEGADOR. Sirve para comparar los
   * dos lados: si el bundle habla con un proyecto y el borde valida contra
   * otro, el token del cajero es legítimo y aun así no vale, y el sistema dice
   * «la sesión no es válida» eternamente sin que nadie entienda por qué.
   */
  supabaseUrl?: string | null;
  /** Un cliente de Membego para probar la llamada de verdad. Opcional. */
  membegoCustomerId?: string | null;
}

/** El host de una URL, o la cadena entera si no es una URL. Nunca lanza. */
function host(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u || '(vacío)';
  }
}

export async function POST(request: Request): Promise<Response> {
  const pasos: Paso[] = [];
  let cuerpo: Cuerpo = {};
  try {
    cuerpo = (await request.json()) as Cuerpo;
  } catch {
    /* El diagnóstico funciona sin cuerpo; solo pierde la comparación de
       proyectos y la llamada de prueba. */
  }

  // ── 1. Configuración del servidor ─────────────────────────────────────────
  // Se dicen los NOMBRES que faltan, nunca los valores. Es el fallo más común y
  // el más invisible: las `VITE_*` se ponen siempre porque sin ellas no carga
  // ni la pantalla de entrar, y estas dos —sin prefijo, solo del servidor— se
  // olvidan porque nada se rompe hasta que alguien pulsa «jalar cliente».
  const faltanAuth = faltaConfiguracionAuth();
  const faltanApi = faltaConfiguracion();
  const faltanTodas = [...new Set([...faltanAuth, ...faltanApi])];

  // EN QUÉ DESPLIEGUE se está corriendo. Sin esto, el informe es ambiguo justo
  // cuando más importa: en Vercel cada variable se marca por entorno, y una
  // puesta solo en Production NO EXISTE en los despliegues de vista previa de
  // una rama. El dueño ve las variables bien puestas en su panel, el
  // diagnóstico dice que faltan, y los dos tienen razón porque están mirando
  // despliegues distintos. Decir el entorno convierte esa contradicción en una
  // instrucción de una línea.
  const entorno = process.env.VERCEL_ENV ?? '';
  const esVistaPrevia = entorno === 'preview';
  const dondeEstoy = entorno
    ? `Este despliegue es «${entorno}».`
    : 'No se pudo determinar el entorno del despliegue.';

  pasos.push({
    clave: 'configuracion',
    titulo: 'Variables del servidor en Vercel',
    estado: faltanTodas.length === 0 ? 'ok' : 'falla',
    detalle:
      faltanTodas.length === 0
        ? `Están todas las variables que necesitan los bordes de Membego. ${dondeEstoy}`
        : `Faltan: ${faltanTodas.join(', ')}. ${dondeEstoy}`,
    arreglo:
      faltanTodas.length === 0
        ? undefined
        : esVistaPrevia
          ? 'Está probando una VISTA PREVIA de una rama, y en Vercel las variables marcadas solo ' +
            'para Production no llegan aquí. Compruébelo en el sitio de producción; si también ' +
            'faltan allí, marque cada variable además para «Preview» (o para los tres entornos) y ' +
            'vuelva a desplegar.'
          : 'Póngalas en Vercel → Settings → Environment Variables, SIN el prefijo VITE_, marcadas ' +
            'para el entorno «Production», y vuelva a desplegar: las variables no se aplican a ' +
            'despliegues ya hechos.',
  });

  // ── 2. ¿El navegador y el servidor hablan del mismo Supabase? ─────────────
  const urlServidor = supabaseDelServidor();
  const urlNavegador = (cuerpo.supabaseUrl ?? '').trim();
  if (!urlServidor || !urlNavegador) {
    pasos.push({
      clave: 'mismo_proyecto',
      titulo: 'El navegador y el servidor usan el mismo Supabase',
      estado: 'omitido',
      detalle: !urlServidor
        ? 'No se puede comparar: al servidor le falta SUPABASE_URL.'
        : 'No se puede comparar: el navegador no envió su VITE_SUPABASE_URL.',
    });
  } else {
    const iguales = host(urlServidor) === host(urlNavegador);
    pasos.push({
      clave: 'mismo_proyecto',
      titulo: 'El navegador y el servidor usan el mismo Supabase',
      estado: iguales ? 'ok' : 'falla',
      detalle: iguales
        ? `Los dos apuntan a ${host(urlServidor)}.`
        : `El navegador usa ${host(urlNavegador)} y el servidor valida contra ${host(urlServidor)}.`,
      arreglo: iguales
        ? undefined
        : 'Iguale SUPABASE_URL y SUPABASE_ANON_KEY (las del servidor) a VITE_SUPABASE_URL y ' +
          'VITE_SUPABASE_ANON_KEY. Mientras no coincidan, ninguna sesión será válida para los bordes.',
    });
  }

  // ── 3, 4 y 5. Los tres pasos del guard, uno a uno ────────────────────────
  // Corren en orden porque cada uno necesita lo del anterior, pero el fallo de
  // uno no cancela el informe: se marcan los siguientes como omitidos y se
  // sigue hasta las comprobaciones de Membego, que sí son independientes.
  // El token se lee DIRECTAMENTE de la cabecera, sin pasar por el guard.
  //
  // El guard comprueba primero la configuración y solo después el token, así
  // que usarlo aquí hacía que a un despliegue sin variables el diagnóstico le
  // dijera «La petición llegó sin sesión» — una causa inventada, sobre una
  // sesión que podía estar perfecta, con un «cierre sesión y vuelva a entrar»
  // que no arreglaba nada. Un diagnóstico que se equivoca manda a arreglar lo
  // que no está roto; es peor que no tenerlo.
  const token = tokenDeLaPeticion(request);
  const faltaSupabase = !urlServidor || faltanAuth.includes('SUPABASE_ANON_KEY');

  let userId = '';
  let vinculoOk = false;
  if (!token) {
    pasos.push({
      clave: 'sesion',
      titulo: 'Su sesión es válida',
      estado: 'falla',
      detalle: 'La petición llegó sin sesión.',
      arreglo: 'Cierre sesión y vuelva a entrar.',
    });
  } else if (faltaSupabase) {
    // Hay sesión; lo que falta es con qué comprobarla.
    pasos.push({
      clave: 'sesion',
      titulo: 'Su sesión es válida',
      estado: 'omitido',
      detalle: 'No se pudo comprobar: al servidor le faltan SUPABASE_URL o SUPABASE_ANON_KEY. '
        + 'Su sesión llegó bien; es el servidor el que no tiene contra qué validarla.',
    });
  } else {
    try {
      userId = await pasoSesion(token);
      pasos.push({
        clave: 'sesion',
        titulo: 'Su sesión es válida',
        estado: 'ok',
        detalle: 'Supabase reconoce el token de esta sesión.',
      });
    } catch (e) {
      pasos.push({
        clave: 'sesion',
        titulo: 'Su sesión es válida',
        estado: 'falla',
        detalle: e instanceof ErrorAuth ? e.message : 'No se pudo verificar la sesión.',
        arreglo: 'Cierre sesión y vuelva a entrar. Si sigue igual, revise el paso anterior.',
      });
    }
  }

  if (!userId) {
    pasos.push({
      clave: 'perfil',
      titulo: 'Su usuario puede consultar Membego',
      estado: 'omitido',
      detalle: 'No se comprobó: la sesión no se pudo verificar.',
    });
    pasos.push({
      clave: 'vinculo',
      titulo: 'Este local está vinculado con Membego',
      estado: 'omitido',
      detalle: 'No se comprobó: la sesión no se pudo verificar.',
    });
  } else {
    // Se prueba con `soloLectura` —lo que exige la ficha— y, si pasa, se dice
    // además si el rol llega para CANJEAR. Un recepcionista que ve la ficha
    // pero no puede gastar el lavado no está roto: es lo previsto, y decirlo
    // aquí evita que alguien lo persiga como si fuera un fallo.
    let rol = '';
    try {
      rol = await pasoPerfil(token, userId, true);
      let puedeCanjear = true;
      try {
        await pasoPerfil(token, userId, false);
      } catch {
        puedeCanjear = false;
      }
      pasos.push({
        clave: 'perfil',
        titulo: 'Su usuario puede consultar Membego',
        estado: 'ok',
        detalle: puedeCanjear
          ? `Su rol es «${rol}»: puede consultar la ficha y canjear beneficios.`
          : `Su rol es «${rol}»: puede consultar la ficha, pero no canjear beneficios al cobrar.`,
      });
    } catch (e) {
      pasos.push({
        clave: 'perfil',
        titulo: 'Su usuario puede consultar Membego',
        estado: 'falla',
        detalle: e instanceof ErrorAuth ? e.message : 'No se pudo comprobar el perfil.',
        arreglo:
          'Un propietario o administrador debe activar su usuario y darle un rol de mostrador ' +
          '(cajero, supervisor, administrador o propietario) en Usuarios.',
      });
    }

    if (!rol) {
      pasos.push({
        clave: 'vinculo',
        titulo: 'Este local está vinculado con Membego',
        estado: 'omitido',
        detalle: 'No se comprobó: su usuario no pasó la comprobación anterior.',
      });
    } else {
      try {
        await pasoVinculo(token);
        vinculoOk = true;
        pasos.push({
          clave: 'vinculo',
          titulo: 'Este local está vinculado con Membego',
          estado: 'ok',
          detalle: `Su empresa está vinculada a la empresa ${empresaMembegoDelDespliegue()} de Membego, y el vínculo está activo.`,
        });
      } catch (e) {
        const mensaje = e instanceof ErrorAuth ? e.message : 'No se pudo comprobar el vínculo.';
        // El caso «cero filas» tiene dos causas que se arreglan en sitios
        // distintos, y la segunda no se le ocurre a nadie: la política RLS que
        // deja al mostrador leer su propio vínculo llega en una migración. Si
        // esa migración no se aplicó, al propietario le funciona y al cajero
        // no, y el sistema culpa a la vinculación, que está perfecta.
        const esCeroFilas = mensaje.includes('todavía no está vinculado');
        pasos.push({
          clave: 'vinculo',
          titulo: 'Este local está vinculado con Membego',
          estado: 'falla',
          detalle: `${mensaje} (El servidor espera la empresa ${empresaMembegoDelDespliegue() || '(sin definir)'}.)`,
          arreglo: esCeroFilas
            ? 'Dos causas posibles: (a) nadie ha vinculado el local — un propietario lo hace en ' +
              'Ajustes → Membego; o (b) falta aplicar la migración ' +
              '20260909130000_membego_vinculo_visible_al_mostrador.sql en la base de datos, que es lo ' +
              'que permite al mostrador leer su propio vínculo. Si al propietario le funciona y al ' +
              'cajero no, es (b).'
            : 'Revise la vinculación en Ajustes → Membego y que MEMBEGO_COMPANY_ID en Vercel sea ese mismo id.',
        });
      }
    }
  }

  // ── 6. ¿Membego acepta las credenciales de este despliegue? ───────────────
  //
  // Desde aquí abajo se SALE a Membego, así que desde aquí abajo hace falta ser
  // alguien. Los cinco pasos anteriores solo leen configuración del propio
  // despliegue y el perfil de quien llama —cosas suyas—, pero pedir un token o
  // preguntar por un cliente son llamadas reales con la credencial del negocio:
  // sin sesión, esta función sería una forma gratuita de gastarle peticiones a
  // Membego y de averiguar qué clientes existen.
  if (!userId) {
    pasos.push({
      clave: 'credencial',
      titulo: 'Membego acepta las credenciales de este local',
      estado: 'omitido',
      detalle: 'No se probó: hace falta una sesión válida para llamar a Membego.',
    });
  } else if (faltanApi.length > 0) {
    pasos.push({
      clave: 'credencial',
      titulo: 'Membego acepta las credenciales de este local',
      estado: 'omitido',
      detalle: `No se probó: faltan ${faltanApi.join(', ')}.`,
    });
  } else {
    const r = await probarCredencial();
    pasos.push({
      clave: 'credencial',
      titulo: 'Membego acepta las credenciales de este local',
      estado: r.ok ? 'ok' : 'falla',
      detalle: r.detalle,
      arreglo: r.ok
        ? undefined
        : `Compruebe MEMBEGO_CLIENT_ID y MEMBEGO_CLIENT_SECRET, y que MEMBEGO_API_URL apunte al ` +
          `Membego correcto (ahora: ${hostApiMembego()}). Ver docs/membego/CREDENCIALES.md.`,
    });
  }

  // ── 7. La llamada de verdad, con un cliente real ─────────────────────────
  // Es la única que prueba lo que el cajero hace. Sin `membegoCustomerId` no se
  // puede: pedir vehículos «de nadie» no demuestra nada.
  //
  // Exige haber pasado el guard ENTERO, no solo tener sesión: es literalmente
  // la llamada que hace `ficha.ts`, y dejarla correr con menos permiso que la
  // de verdad convertiría el diagnóstico en la puerta de atrás que el guard
  // existe para cerrar.
  const clienteId = (cuerpo.membegoCustomerId ?? '').trim();
  if (!vinculoOk) {
    pasos.push({
      clave: 'ficha',
      titulo: 'La ficha del cliente se puede consultar',
      estado: 'omitido',
      detalle: 'No se probó: primero tienen que pasar las comprobaciones anteriores.',
    });
  } else if (!clienteId) {
    pasos.push({
      clave: 'ficha',
      titulo: 'La ficha del cliente se puede consultar',
      estado: 'omitido',
      detalle: 'No se probó: abra primero un cliente que tenga Membego y repita el diagnóstico.',
    });
  } else if (faltanApi.length > 0) {
    pasos.push({
      clave: 'ficha',
      titulo: 'La ficha del cliente se puede consultar',
      estado: 'omitido',
      detalle: `No se probó: faltan ${faltanApi.join(', ')}.`,
    });
  } else {
    try {
      const r = await llamar<{ vehicles: unknown[] }>(
        `/vehicles?companyId=${encodeURIComponent(COMPANY_ID)}&customerId=${encodeURIComponent(clienteId)}`
      );
      pasos.push({
        clave: 'ficha',
        titulo: 'La ficha del cliente se puede consultar',
        estado: 'ok',
        detalle: `Membego devolvió ${r.vehicles?.length ?? 0} vehículo(s) de este cliente.`,
      });
    } catch (e) {
      const status = e instanceof ErrorMembego ? e.status : 0;
      // 404 aquí casi nunca significa «Membego está mal»: significa que ESE
      // cliente no está en ESTA empresa de Membego. Pasa cuando el id se copió
      // de otro entorno o cuando se cambió MEMBEGO_COMPANY_ID sin rehacer la
      // sincronización. Es la causa que el guard no puede ver, porque el guard
      // valida la empresa, no el cliente.
      const esNoEncontrado = status === 404;
      pasos.push({
        clave: 'ficha',
        titulo: 'La ficha del cliente se puede consultar',
        estado: 'falla',
        detalle:
          e instanceof ErrorMembego ? e.message : 'No se pudo consultar la ficha del cliente.',
        arreglo: esNoEncontrado
          ? `Este cliente no existe en la empresa ${COMPANY_ID} de Membego. Su ficha guarda un ` +
            'identificador de Membego de otra empresa o de otro entorno: vuelva a vincular el ' +
            'cliente desde su ficha, o corrija MEMBEGO_COMPANY_ID si el equivocado es el despliegue.'
          : undefined,
      });
    }
  }

  const primerFallo = pasos.find((p) => p.estado === 'falla');
  return json(
    {
      pasos,
      ok: !primerFallo,
      // El resumen existe para que el mostrador no tenga que interpretar siete
      // filas: una frase que se pueda leer en voz alta por teléfono.
      resumen: primerFallo
        ? `${primerFallo.titulo}: ${primerFallo.detalle}`
        : 'Todo lo que se puede comprobar desde aquí está en orden.',
      // El host, siempre: si alguien mandó una captura, esto ahorra la primera
      // pregunta de vuelta.
      apiMembego: hostApiMembego(),
      entorno,
    },
    200
  );
}
