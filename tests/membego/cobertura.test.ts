/**
 * Pruebas de la costura entre el derecho y el dinero.
 *
 * Todo lo que se comprueba aquí cuesta plata si sale mal: cubrir de más regala
 * lavados, cubrir de menos cobra dos veces al cliente que ya pagó su membresía.
 */
import {
  aplicarCobertura, categoriaTopeDelPlan,
  type MembresiaEvaluada, type LineaCobrable
} from '../../src/lib/coberturaMembego.ts';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detalle = '') => {
  if (cond) { pass++; console.log('  PASA  ' + name); }
  else { fail++; console.log('  FALLA ' + name + (detalle ? `  [${detalle}]` : '')); }
};

const NIVELES = { sedan: 1, suv: 2, jeep: 2, pickup: 3, truck: 4 };

const membresia = (over: Partial<MembresiaEvaluada['coverage']> & { usesLeft?: number } = {}): MembresiaEvaluada => ({
  id: 'memb-1',
  nombre: 'Plan Sedán',
  usesLeft: over.usesLeft ?? 3,
  coverage: {
    vehicleLevelMax: over.vehicleLevelMax !== undefined ? over.vehicleLevelMax : 1,
    unlimited: over.unlimited ?? false,
    covers: over.covers !== undefined ? over.covers : true,
    reason: over.reason !== undefined ? over.reason : null
  }
});

const lavado = (over: Partial<LineaCobrable> = {}): LineaCobrable => ({
  serviceId: 'srv-lavado',
  incluidoEnMembego: true,
  unitPriceCents: 80000,
  quantity: 1,
  ...over
});

const sinPrecioTope = () => null;
const precioSedan = () => 50000;

console.log('\n[1] La categoría tope del plan');
check('elige la categoría más cara dentro del tope',
  categoriaTopeDelPlan(NIVELES, 3) === 'pickup');
check('con tope 1 se queda en el sedán',
  categoriaTopeDelPlan(NIVELES, 1) === 'sedan');
check('sin ninguna categoría dentro del tope devuelve null, no inventa una',
  categoriaTopeDelPlan({ pickup: 3, truck: 4 }, 1) === null);
check('una tabla de niveles vacía no produce equivalencias',
  categoriaTopeDelPlan({}, 5) === null);

console.log('\n[2] Cuando cubre');
{
  const r = aplicarCobertura({
    membresias: [membresia()], lineas: [lavado()], precioEnCategoriaTope: sinPrecioTope
  });
  check('absorbe el lavado entero', r.coveredCents === 80000);
  check('y no deja diferencia', r.differenceCents === 0);
  check('apunta a la línea correcta', r.lineaIndex === 0);
  check('y dice qué membresía fue', r.membershipId === 'memb-1');
}

console.log('\n[3] La diferencia a pagar — el caso que motivó todo');
{
  // Plan de sedán (500), llega en camioneta (800). Paga los 300 de salto.
  const r = aplicarCobertura({
    membresias: [membresia({ covers: false, reason: 'VEHICLE_LEVEL_ABOVE_PLAN' })],
    lineas: [lavado({ unitPriceCents: 80000 })],
    precioEnCategoriaTope: precioSedan
  });
  check('la membresía absorbe lo que valía en su categoría', r.coveredCents === 50000);
  check('el cliente paga solo el salto de categoría', r.differenceCents === 30000);
  check('lo cubierto más la diferencia es el precio real',
    r.coveredCents + r.differenceCents === 80000);
  check('y se explica al cajero', /diferencia/i.test(r.explicacion), r.explicacion);
}

console.log('\n[4] Lo que NO se regala');
{
  const r = aplicarCobertura({
    membresias: [membresia({ covers: false, reason: 'NO_USES_LEFT', usesLeft: 0 })],
    lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('sin lavados disponibles no se cubre nada', r.coveredCents === 0);
  check('y no se calcula media tarifa: no tiene derecho a este lavado',
    r.differenceCents === 0 && r.lineaIndex === null);
}
{
  const r = aplicarCobertura({
    membresias: [membresia({ covers: false, reason: 'VEHICLE_NOT_IN_MEMBERSHIP' })],
    lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('una placa ajena a la membresía se cobra completa',
    r.coveredCents === 0 && r.lineaIndex === null);
}
{
  // El guard del dinero: sin precio de referencia NO se inventa la diferencia.
  const r = aplicarCobertura({
    membresias: [membresia({ covers: false, reason: 'VEHICLE_LEVEL_ABOVE_PLAN' })],
    lineas: [lavado()], precioEnCategoriaTope: sinPrecioTope
  });
  check('sin precio de la categoría del plan no se adivina la diferencia',
    r.coveredCents === 0);
  check('y se dice por qué se cobró completo',
    /falta el precio/i.test(r.explicacion), r.explicacion);
}
{
  const r = aplicarCobertura({
    membresias: [membresia({ covers: null })],
    lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('«no se preguntó» no sirve para cobrar: se descarta como un no',
    r.coveredCents === 0 && r.lineaIndex === null);
}
{
  const r = aplicarCobertura({
    membresias: [], lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('sin membresías no se cubre nada', r.coveredCents === 0);
}

console.log('\n[5] Qué línea se cubre');
{
  const r = aplicarCobertura({
    membresias: [membresia()],
    lineas: [lavado({ unitPriceCents: 30000 }), lavado({ unitPriceCents: 90000 })],
    precioEnCategoriaTope: precioSedan
  });
  check('se cubre el lavado MÁS CARO, no el que se tecleó primero',
    r.lineaIndex === 1 && r.coveredCents === 90000);
}
{
  const r = aplicarCobertura({
    membresias: [membresia()],
    lineas: [
      { serviceId: null, incluidoEnMembego: false, unitPriceCents: 200000, quantity: 1 },
      lavado({ unitPriceCents: 40000 })
    ],
    precioEnCategoriaTope: precioSedan
  });
  check('un producto caro no se cubre aunque sea la línea mayor',
    r.lineaIndex === 1 && r.coveredCents === 40000);
}
{
  const r = aplicarCobertura({
    membresias: [membresia()],
    lineas: [lavado({ incluidoEnMembego: false })],
    precioEnCategoriaTope: precioSedan
  });
  check('un servicio no incluido en Membego no lo cubre la membresía',
    r.coveredCents === 0 && r.lineaIndex === null);
}
{
  // Una membresía cubre UN lavado. Si el cajero teclea 2, el segundo se cobra.
  const r = aplicarCobertura({
    membresias: [membresia()],
    lineas: [lavado({ unitPriceCents: 50000, quantity: 3 })],
    precioEnCategoriaTope: precioSedan
  });
  check('cubre un solo lavado aunque la cantidad sea 3',
    r.coveredCents === 50000);
}

console.log('\n[6] Con varias membresías');
{
  const parcial = membresia({ covers: false, reason: 'VEHICLE_LEVEL_ABOVE_PLAN' });
  const completa = { ...membresia(), id: 'memb-2', nombre: 'Plan Camioneta' };
  const r = aplicarCobertura({
    membresias: [parcial, completa], lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('manda la que CUBRE, no la primera de la lista',
    r.membershipId === 'memb-2' && r.differenceCents === 0);
}
{
  // Ninguna cubre: se coge una y se explica, en vez de callar.
  const r = aplicarCobertura({
    membresias: [
      membresia({ covers: false, reason: 'VEHICLE_NOT_IN_MEMBERSHIP' }),
      { ...membresia({ covers: false, reason: 'VEHICLE_NOT_IN_MEMBERSHIP' }), id: 'memb-2' }
    ],
    lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('si ninguna cubre, no se cubre nada y se dice por qué',
    r.coveredCents === 0 && /placa/i.test(r.explicacion), r.explicacion);
}

console.log('\n[7] Bordes de tarifa mal configurada');
{
  // Camioneta configurada MÁS BARATA que el sedán. No se le devuelve dinero.
  const r = aplicarCobertura({
    membresias: [membresia({ covers: false, reason: 'VEHICLE_LEVEL_ABOVE_PLAN' })],
    lineas: [lavado({ unitPriceCents: 40000 })],
    precioEnCategoriaTope: () => 50000
  });
  check('el tope nunca supera el precio real: no se devuelve dinero',
    r.coveredCents === 40000 && r.differenceCents === 0);
}
{
  const r = aplicarCobertura({
    membresias: [membresia({ unlimited: true, usesLeft: 0 })],
    lineas: [lavado()], precioEnCategoriaTope: precioSedan
  });
  check('un plan ilimitado con 0 usos sigue cubriendo', r.coveredCents === 80000);
}

console.log(`\n${pass} pasan · ${fail} fallan`);
if (fail > 0) process.exit(1);
