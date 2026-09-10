import type { VehicleCategory } from '../types';

/**
 * QUIÉN DECIDE QUÉ, Y POR QUÉ ESTÁ PARTIDO ASÍ
 *
 * Membego decide si la membresía DA DERECHO al lavado. El car wash decide
 * CUÁNTO VALE. Ninguno de los dos puede hacer la parte del otro:
 *
 *   · Membego no conoce la tarifa de este lavadero y no debe inventarla. Por eso
 *     su respuesta trae `covers` y `reason`, y ni un solo precio.
 *   · El car wash no conoce el saldo de lavados ni las reglas del plan. Por eso
 *     no recalcula el derecho: se cree lo que Membego contestó.
 *
 * Este módulo es la costura: toma el veredicto de Membego y lo convierte en
 * centavos con la tarifa de AQUÍ. No consulta nada — recibe todo y devuelve
 * números, para poder probarlo sin red y sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA DIFERENCIA A PAGAR
 *
 * El caso que motivó todo esto: un cliente con plan de sedán llega en camioneta.
 * Su membresía no cubre la camioneta, pero tampoco es justo cobrarle el lavado
 * entero — pagó por un lavado, y lo que le falta es el salto de categoría.
 *
 * Así que la membresía absorbe lo que valdría ese mismo servicio en la categoría
 * TOPE DE SU PLAN, y el cliente paga el resto. Un plan de sedán con un lavado de
 * camioneta de 800 cubre los 500 del sedán y el cliente pone 300.
 *
 * Esto solo aplica cuando Membego dice que el motivo es la categoría
 * (`VEHICLE_LEVEL_ABOVE_PLAN`). Si el motivo es que no le quedan lavados o que
 * la placa no está en su membresía, no hay nada que absorber: no tiene derecho a
 * este lavado, y regalarle media tarifa sería inventar un beneficio.
 */

/** Lo que Membego contestó sobre una membresía. Subconjunto de `BeneficioMembego`. */
export interface MembresiaEvaluada {
  id: string;
  nombre: string;
  usesLeft: number;
  coverage: {
    vehicleLevelMax: number | null;
    unlimited: boolean;
    covers: boolean | null;
    reason: string | null;
  } | null;
}

/** Una línea de la venta, tal como está en el carrito. */
export interface LineaCobrable {
  /** `null` en productos. Un producto no lo cubre ninguna membresía. */
  serviceId: string | null;
  /** Si el servicio está marcado como incluible en Membego. */
  incluidoEnMembego: boolean;
  unitPriceCents: number;
  quantity: number;
}

export interface AplicacionCobertura {
  /** Índice de la línea que absorbe la membresía. `null` = ninguna. */
  lineaIndex: number | null;
  membershipId: string | null;
  membershipNombre: string | null;
  /** Lo que absorbe la membresía, en centavos. */
  coveredCents: number;
  /** Lo que el cliente paga por encima del beneficio. */
  differenceCents: number;
  /**
   * Por qué salió así, en castellano y para el cajero. Se enseña SIEMPRE, también
   * cuando cubre: un cajero que no sabe por qué el total bajó no puede defenderlo
   * delante del cliente.
   */
  explicacion: string;
}

const SIN_COBERTURA = (explicacion: string): AplicacionCobertura => ({
  lineaIndex: null, membershipId: null, membershipNombre: null,
  coveredCents: 0, differenceCents: 0, explicacion
});

/**
 * EL EFECTO MONETARIO DE UNA PROMOCIÓN, tal como lo manda Membego.
 *
 * Membego decide qué rebaja una promoción; el car wash decide sobre qué línea y
 * con qué tarifa. Igual que con la membresía, la regla de negocio (el tipo de
 * promo, el porcentaje, el monto) vive en Membego y viaja en este `effect`; aquí
 * solo se traduce a centavos sobre el servicio de ESTA venta.
 *
 * `NONE` es deliberado y NO es un error: un 2x1, un upgrade o un regalo no tienen
 * una rebaja automática que el mostrador pueda calcular sin equivocarse, así que
 * Membego lo dice y el car wash no toca la factura — la promo se aplica a mano.
 */
export type EfectoPromocion =
  | { kind: 'PERCENT'; value: number; label: string }
  | { kind: 'AMOUNT'; amountCents: number; label: string }
  | { kind: 'FREE'; label: string }
  | { kind: 'NONE'; label: string };

export interface AplicacionPromocion {
  /** Índice de la línea que rebaja la promoción. `null` = ninguna. */
  lineaIndex: number | null;
  /** Lo que la promoción rebaja, en centavos (nunca más que un servicio). */
  discountCents: number;
  /** Por qué salió así, para el cajero. Se enseña siempre. */
  explicacion: string;
}

const SIN_PROMO = (explicacion: string): AplicacionPromocion => ({
  lineaIndex: null, discountCents: 0, explicacion
});

/**
 * Cuánto rebaja una promoción en esta venta.
 *
 * UN canje = UN servicio. La promoción rebaja UNA unidad del servicio más caro
 * del carrito (nunca un producto: una fragancia o un café no es lo que promete
 * una promo de lavado), y nunca más que el precio de ese servicio — un cupón de
 * «RD$500» sobre un lavado de 300 rebaja 300, no regala dinero. Eso mantiene el
 * canje honesto: se consume un uso y se descuenta un servicio.
 *
 * El servidor (`create_invoice`) recalcula y acota igual; esto es lo que ve el
 * cajero antes de cobrar.
 */
export function descuentoPromocion(params: {
  effect: EfectoPromocion | null;
  nombre: string;
  lineas: LineaCobrable[];
}): AplicacionPromocion {
  const { effect, nombre, lineas } = params;

  if (!effect || effect.kind === 'NONE') {
    return SIN_PROMO(
      `${nombre} no tiene una rebaja automática: aplícala a mano si corresponde.`
    );
  }

  // Solo servicios. El más caro, no el primero que tecleó el cajero.
  const servicios = lineas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.serviceId !== null);
  if (servicios.length === 0) {
    return SIN_PROMO(`Agrega el servicio para aplicar ${nombre}.`);
  }
  const elegida = servicios.reduce((mejor, actual) =>
    actual.l.unitPriceCents > mejor.l.unitPriceCents ? actual : mejor
  );

  const precioUnidad = elegida.l.unitPriceCents;
  let bruto: number;
  switch (effect.kind) {
    case 'FREE':
      bruto = precioUnidad;
      break;
    case 'PERCENT':
      bruto = Math.round((precioUnidad * effect.value) / 100);
      break;
    case 'AMOUNT':
      bruto = effect.amountCents;
      break;
  }

  // Nunca más que un servicio: la promo rebaja, no paga de más.
  const discountCents = Math.max(0, Math.min(bruto, precioUnidad));
  if (discountCents === 0) {
    return SIN_PROMO(`${nombre} no rebaja nada en este servicio.`);
  }

  return {
    lineaIndex: elegida.i,
    discountCents,
    explicacion:
      effect.kind === 'FREE'
        ? `${nombre}: este servicio va gratis.`
        : `${nombre} (${effect.label}) aplicada a este servicio.`,
  };
}

/**
 * La categoría más cara que el plan sí cubre.
 *
 * Sube por los niveles configurados y se queda con el mayor que no pase del tope
 * del plan. Devuelve `null` si ninguna categoría tiene nivel dentro del tope —
 * pasa cuando la tabla de niveles está a medio llenar, y entonces NO se inventa
 * una equivalencia: sin ella no hay diferencia que calcular.
 */
export function categoriaTopeDelPlan(
  niveles: Partial<Record<VehicleCategory, number>>,
  nivelMaximo: number
): VehicleCategory | null {
  let mejor: VehicleCategory | null = null;
  let mejorNivel = 0;
  for (const [categoria, nivel] of Object.entries(niveles) as [VehicleCategory, number][]) {
    if (nivel <= nivelMaximo && nivel >= mejorNivel) { mejor = categoria; mejorNivel = nivel; }
  }
  return mejor;
}

/**
 * Cuánto absorbe la membresía en esta venta.
 *
 * @param precioEnCategoriaTope Precio del servicio elegido en la categoría tope
 *        del plan. `null` si no se pudo averiguar — y entonces no se cubre nada,
 *        porque adivinarlo es regalar dinero del negocio.
 */
export function aplicarCobertura(params: {
  membresias: MembresiaEvaluada[];
  lineas: LineaCobrable[];
  precioEnCategoriaTope: (serviceId: string) => number | null;
}): AplicacionCobertura {
  const { membresias, lineas, precioEnCategoriaTope } = params;

  // Solo servicios marcados como incluibles. Un producto —una fragancia, un
  // café— nunca lo paga una membresía de lavados.
  const candidatas = lineas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.serviceId !== null && l.incluidoEnMembego);

  if (candidatas.length === 0) {
    return SIN_COBERTURA('Nada en esta venta entra en una membresía.');
  }

  // Las que de verdad pueden usarse ahora. `covers === null` es «no se
  // preguntó» y no sirve para cobrar: se descarta igual que un «no».
  const usables = membresias.filter(m =>
    m.coverage !== null &&
    (m.coverage.unlimited || m.usesLeft > 0) &&
    m.coverage.covers !== null
  );

  // Con varias, manda la que CUBRE. Quedarse con la primera de la lista haría
  // que un cliente con dos planes pagara la diferencia de uno teniendo el otro
  // cubriéndole el lavado entero, y el orden lo decide Membego, no él.
  const usable = usables.find(m => m.coverage!.covers === true) ?? usables[0];

  if (!usable || !usable.coverage) {
    return SIN_COBERTURA('Sin membresía aplicable a este vehículo.');
  }

  // El cliente se lleva su mejor lavado, no el primero que tecleó el cajero.
  // Cubrir el más barato teniendo derecho al más caro es cobrarle de más por un
  // detalle de orden de captura.
  const elegida = candidatas.reduce((mejor, actual) =>
    actual.l.unitPriceCents > mejor.l.unitPriceCents ? actual : mejor
  );

  const precioLinea = elegida.l.unitPriceCents;
  const cobertura = usable.coverage;

  if (cobertura.covers === true) {
    // Una membresía cubre UN lavado, no la cantidad que se teclee. Si el cajero
    // puso 2, el segundo se cobra.
    return {
      lineaIndex: elegida.i,
      membershipId: usable.id,
      membershipNombre: usable.nombre,
      coveredCents: precioLinea,
      differenceCents: 0,
      explicacion: `${usable.nombre} cubre este lavado.`
    };
  }

  if (cobertura.reason === 'VEHICLE_LEVEL_ABOVE_PLAN' && cobertura.vehicleLevelMax !== null) {
    const tope = precioEnCategoriaTope(elegida.l.serviceId!);

    // Sin precio de referencia no hay diferencia que calcular. Se dice, no se
    // adivina: un cobro inventado es peor que un cobro completo explicado.
    if (tope === null) {
      return SIN_COBERTURA(
        `${usable.nombre} no cubre esta categoría y falta el precio de la categoría del plan ` +
        'para calcular la diferencia. El lavado se cobra completo.'
      );
    }

    // El tope no puede pasarse del precio real: si alguien configuró la
    // camioneta más barata que el sedán, la membresía cubre el lavado entero y
    // no le devuelve dinero al cliente.
    const cubierto = Math.max(0, Math.min(tope, precioLinea));
    return {
      lineaIndex: elegida.i,
      membershipId: usable.id,
      membershipNombre: usable.nombre,
      coveredCents: cubierto,
      differenceCents: precioLinea - cubierto,
      explicacion: cubierto === precioLinea
        ? `${usable.nombre} cubre este lavado.`
        : `${usable.nombre} cubre hasta la categoría de su plan. La diferencia se cobra.`
    };
  }

  return SIN_COBERTURA(
    cobertura.reason === 'NO_USES_LEFT'
      ? `${usable.nombre} no tiene lavados disponibles. Se cobra completo.`
      : cobertura.reason === 'VEHICLE_NOT_IN_MEMBERSHIP'
        ? 'Esta placa no está en su membresía. Se cobra completo.'
        : `${usable.nombre} no cubre este lavado. Se cobra completo.`
  );
}

// ───────────────────────────── Por qué la membresía no encuentra qué cubrir

/**
 * Qué hacer cuando el cajero pulsa «Aplicar al lavado».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UNA FUNCIÓN Y NO UN `if` DENTRO DE LA PANTALLA
 *
 * Porque el aviso que sale aquí es lo único que el mostrador tiene para
 * arreglar el problema, y hasta ahora decía siempre lo mismo: «márcalo en el
 * catálogo». Cuando la causa era otra —el servicio marcado no tiene precio para
 * esa categoría, o el que se está vendiendo no es el marcado— ese texto mandaba
 * a cambiar algo que ya estaba bien. Un aviso que da la instrucción equivocada
 * cuesta más que no dar ninguna.
 *
 * Las cuatro salidas son las cuatro situaciones reales, y cada una dice la que
 * corresponde.
 */
export type DecisionBeneficio =
  /** Ya hay en la venta un servicio incluible: la cobertura lo toma sola. */
  | { accion: 'nada' }
  /** La venta no trae lavado: se agrega el incluible más caro de la categoría. */
  | { accion: 'agregar'; servicioId: string }
  /** No se puede aplicar. `texto` explica por qué y qué hacer. */
  | { accion: 'avisar'; texto: string };

export interface EntradaDecision {
  /** Servicios incluibles CON precio para la categoría del vehículo. */
  incluiblesEnCategoria: readonly { id: string; name: string; price_cents: number }[];
  /** Servicios incluibles del catálogo entero, sin mirar categoría. */
  incluiblesEnCatalogo: readonly { name: string }[];
  /** Las líneas de SERVICIO que ya tiene la venta (los productos no cuentan). */
  lineasServicio: readonly { serviceId: string; name: string }[];
  /** Cómo se llama la categoría del vehículo, para poder nombrarla. */
  categoriaLabel: string;
}

const listar = (nombres: readonly string[], max = 3): string => {
  const vistos = nombres.slice(0, max).map(n => `«${n}»`);
  const resto = nombres.length - vistos.length;
  const texto = vistos.join(', ');
  return resto > 0 ? `${texto} y ${resto} más` : texto;
};

export function decidirAplicarMembresia(e: EntradaDecision): DecisionBeneficio {
  // 1. La venta ya trae un lavado incluible. No se toca nada: `aplicarCobertura`
  //    ya lo descuenta. Agregar otro sería cobrar dos lavados.
  const yaIncluible = e.lineasServicio.some(l =>
    e.incluiblesEnCategoria.some(s => s.id === l.serviceId));
  if (yaIncluible) return { accion: 'nada' };

  // 2. Nadie marcó nunca ningún servicio. Es el caso que deja la cobertura de
  //    membresías sin funcionar en silencio: la casilla nace apagada y nada la
  //    enciende sola —Membego no conoce este catálogo y no puede marcarla—.
  if (e.incluiblesEnCatalogo.length === 0) {
    return {
      accion: 'avisar',
      texto:
        'Ningún servicio del catálogo está marcado como «Incluido en el beneficio ' +
        'Membego», así que la membresía no tiene qué cubrir. Márquelo en ' +
        'Configuración → Servicios, en la ficha del servicio.'
    };
  }

  // 3. Hay marcados, pero ninguno tiene precio para ESTA categoría. El aviso
  //    viejo mandaba a marcar una casilla que ya estaba marcada.
  if (e.incluiblesEnCategoria.length === 0) {
    return {
      accion: 'avisar',
      texto:
        `${listar(e.incluiblesEnCatalogo.map(s => s.name))} está marcado como ` +
        `incluible en Membego, pero no tiene precio para ${e.categoriaLabel}. ` +
        `Póngale precio a esa categoría en Configuración → Servicios.`
    };
  }

  // 4. La venta ya trae lavado —viene de la orden— y no es de los incluibles.
  //    Agregar el incluible facturaría DOS lavados del mismo carro, así que se
  //    dice lo que pasa y se deja la decisión en el mostrador.
  if (e.lineasServicio.length > 0) {
    return {
      accion: 'avisar',
      texto:
        `${listar(e.lineasServicio.map(l => l.name))} no está marcado como ` +
        '«Incluido en el beneficio Membego», así que la membresía no lo puede ' +
        'cubrir. Márquelo en Configuración → Servicios, o cambie la venta al ' +
        `servicio que sí cubre el plan (${listar(e.incluiblesEnCategoria.map(s => s.name))}).`
    };
  }

  // 5. Venta vacía de servicios: se agrega el mejor lavado del cliente. El más
  //    caro y no el primero, por lo mismo que en `aplicarCobertura`: cubrir el
  //    más barato teniendo derecho al más caro es cobrarle de más.
  const mejor = e.incluiblesEnCategoria.reduce((a, b) =>
    b.price_cents > a.price_cents ? b : a);
  return { accion: 'agregar', servicioId: mejor.id };
}
