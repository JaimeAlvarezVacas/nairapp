const test = require('node:test');
const assert = require('node:assert/strict');
const l = require('./logic.js');

test('dateKey usa la hora local, también de noche', () => {
  assert.equal(l.dateKey(new Date(2026, 10, 3, 23, 59)), '2026-11-03');
  assert.equal(l.dateKey(new Date(2026, 10, 3, 0, 1)), '2026-11-03');
});

test('addDays cruza meses y cambios de hora', () => {
  assert.equal(l.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(l.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(l.addDays('2026-01-01', -1), '2025-12-31');
});

test('setMeal marca, cambia y desmarca sin dejar días vacíos', () => {
  const log = {};
  l.setMeal(log, '2026-11-03', 'cena', 'Tortilla');
  assert.equal(log['2026-11-03'].cena, 'Tortilla');
  l.setMeal(log, '2026-11-03', 'cena', 'Pescado');
  assert.equal(log['2026-11-03'].cena, 'Pescado');
  l.setMeal(log, '2026-11-03', 'cena', null);
  assert.deepEqual(log, {});
});

test('cheat meal con y sin nota', () => {
  assert.equal(l.cheatText('  '), 'Cheat meal');
  assert.equal(l.cheatText(' pizza '), 'Cheat meal: pizza');
  assert.equal(l.cheatNote('Cheat meal: pizza'), 'pizza');
  assert.equal(l.cheatNote('Cheat meal'), '');
  assert.equal(l.isCheat('Cheat meal: pizza'), true);
  assert.equal(l.isCheat('Cheat mealsito'), false);
  assert.equal(l.isCheat(undefined), false);
});

test('parseBoxes con una opción por línea en cada cuadro', () => {
  const { options } = l.parseBoxes({ desayuno: 'Avena\r\n\nTostada\nAvena', comida: '', merienda: '• Fruta', cena: 'Sopa' });
  assert.deepEqual(options, { desayuno: ['Avena', 'Tostada'], comida: [], merienda: ['Fruta'], cena: ['Sopa'] });
});

test('parseBoxes guarda los ingredientes por comida y opción', () => {
  const pasted = '# Desayuno\nYogur\n- 1 unidad de A\n• 2 unidades de B\nTostada\n# Merienda\nYogur\n- 3 unidades de C';
  const { options, details } = l.parseBoxes({ desayuno: pasted });
  assert.deepEqual(options.desayuno, ['Yogur', 'Tostada']);
  assert.deepEqual(details.desayuno, { Yogur: ['1 unidad de A', '2 unidades de B'] });
  assert.deepEqual(details.merienda, { Yogur: ['3 unidades de C'] });
});

test('una línea con guion tras una cabecera es una opción, no un ingrediente de la comida anterior', () => {
  const { options, details } = l.parseBoxes({ desayuno: '# Desayuno\nAvena\n# Cena\n- Sopa' });
  assert.deepEqual(options.cena, ['Sopa']);
  assert.deepEqual(details.desayuno, {});
});

test('parseBoxes separa preparación, consejos de la comida y consejos generales', () => {
  const pasted = '# Cena\n! Pesar antes\nSopa\n- 1 unidad de A\n> Paso uno\n> Paso dos\nPescado\n# Consejos\nBeber agua\n- Descansar\n! Caminar';
  const r = l.parseBoxes({ desayuno: pasted });
  assert.deepEqual(r.options.cena, ['Sopa', 'Pescado']);
  assert.deepEqual(r.details.cena, { Sopa: ['1 unidad de A'] });
  assert.deepEqual(r.prep.cena, { Sopa: ['Paso uno', 'Paso dos'] });
  assert.deepEqual(r.tips.cena, ['Pesar antes']);
  assert.deepEqual(r.tips.consejos, ['Beber agua', 'Descansar', 'Caminar']);
});

test('los cuadros de la pauta conservan todo al guardar de nuevo', () => {
  const pasted = '# Cena\n! Pesar antes\nSopa\n- 1 unidad de A\n> Paso uno\nPescado\n# Consejos\nBeber agua';
  const state = { ...l.emptyState(), ...l.parseBoxes({ desayuno: pasted }) };
  const boxes = Object.fromEntries(l.SECTIONS.map(s => [s, l.formatBox(state, s)]));
  assert.equal(boxes.cena, '! Pesar antes\nSopa\n- 1 unidad de A\n> Paso uno\nPescado');
  assert.equal(boxes.consejos, 'Beber agua');
  assert.deepEqual(l.parseBoxes(boxes), l.parseBoxes({ desayuno: pasted }));
});

test('detailsOf no confunde nombres de opción con propiedades internas', () => {
  const { details } = l.parseBoxes({ cena: 'constructor\n__proto__\n- 1 huevo' });
  assert.deepEqual(l.detailsOf(details, 'cena', 'constructor'), []);
  assert.deepEqual(l.detailsOf(details, 'cena', '__proto__'), ['1 huevo']);
  assert.deepEqual(l.detailsOf(details, 'cena', 'toString'), []);
});

test('parseBoxes reparte la pauta pegada y reemplaza lo anterior', () => {
  const pasted = '# Desayuno\nAvena\n# COMIDA:\nPollo\n## Merienda\nFruta\n# Cena\nSopa';
  const { options } = l.parseBoxes({ desayuno: pasted, comida: 'Vieja', merienda: 'Vieja', cena: 'Vieja' });
  assert.deepEqual(options, { desayuno: ['Avena'], comida: ['Pollo'], merienda: ['Fruta'], cena: ['Sopa'] });
});

test('parseBoxes conserva los cuadros que la pauta pegada no nombra', () => {
  const { options } = l.parseBoxes({ desayuno: '# Cena\nSopa', comida: 'Pollo', merienda: '', cena: 'Vieja' });
  assert.deepEqual(options.cena, ['Sopa']);
  assert.deepEqual(options.comida, ['Pollo']);
});

test('parseBoxes rechaza cabeceras desconocidas', () => {
  assert.throws(() => l.parseBoxes({ desayuno: '# Snack\nNueces' }), /Snack/);
});

test('cambiar la pauta no altera el historial', () => {
  const state = l.emptyState();
  state.options.cena = ['Sopa'];
  l.setMeal(state.log, '2026-11-03', 'cena', 'Sopa');
  Object.assign(state, l.parseBoxes({ cena: 'Tortilla' }));
  assert.equal(state.log['2026-11-03'].cena, 'Sopa');
});

test('loadState conserva los datos ilegibles para no sobrescribirlos', () => {
  assert.equal(l.loadState(null).corrupt, null);
  assert.equal(l.loadState('{roto').corrupt, '{roto');
  assert.equal(l.loadState('{"options":{},"log":{}}').corrupt, '{"options":{},"log":{}}');
  const good = JSON.stringify(l.emptyState());
  assert.equal(l.loadState(good).corrupt, null);
});

test('los datos y copias sin ingredientes siguen funcionando', () => {
  const { options, log } = l.emptyState();
  options.cena = ['Sopa'];
  const loaded = l.loadState(JSON.stringify({ options, log, lastBackup: null }));
  assert.equal(loaded.corrupt, null);
  assert.deepEqual(l.detailsOf(loaded.state.details, 'cena', 'Sopa'), []);

  const old = JSON.stringify({ app: 'comidas', v: 1, createdAt: '2026-11-03T00:00:00Z', options, log });
  const { state } = l.mergeBackup(l.emptyState(), l.parseBackup(old));
  assert.deepEqual(state.options.cena, ['Sopa']);
  assert.deepEqual(state.details.cena, {});
});

test('la copia guarda y restaura ingredientes, preparación y consejos', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ cena: '! Pesar antes\nSopa\n- 100 g de calabaza\n> Hervir', consejos: 'Beber agua' }) };
  const back = l.parseBackup(JSON.stringify(l.makeBackup(state, new Date('2026-11-03T20:00:00Z'))));
  const restored = l.mergeBackup(l.emptyState(), back).state;
  assert.deepEqual(restored.details.cena, { Sopa: ['100 g de calabaza'] });
  assert.deepEqual(restored.prep.cena, { Sopa: ['Hervir'] });
  assert.deepEqual(restored.tips.cena, ['Pesar antes']);
  assert.deepEqual(restored.tips.consejos, ['Beber agua']);

  const phone = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Pescado\n- 110 g de merluza' }) };
  assert.deepEqual(l.mergeBackup(phone, back).state.details.cena, { Pescado: ['110 g de merluza'] });
});

test('copia de ida y vuelta', () => {
  const state = l.emptyState();
  state.options.cena = ['Sopa'];
  l.setMeal(state.log, '2026-11-03', 'cena', 'Sopa');
  const now = new Date('2026-11-03T20:00:00Z');
  const back = l.parseBackup(JSON.stringify(l.makeBackup(state, now)));
  const { state: restored, added } = l.mergeBackup(l.emptyState(), back);
  assert.equal(added, 1);
  assert.deepEqual(restored.log, state.log);
  assert.deepEqual(restored.options, state.options);
  assert.equal(restored.lastBackup, now.toISOString());
});

test('restaurar combina sin borrar y gana lo que hay en el móvil', () => {
  const phone = l.emptyState();
  phone.options.cena = ['Nueva'];
  phone.log = { '2026-11-03': { cena: 'Móvil' }, '2026-11-04': { cena: 'Solo móvil' } };
  const backup = {
    createdAt: '2026-11-02T00:00:00Z',
    options: { desayuno: [], comida: [], merienda: [], cena: ['Vieja'] },
    log: { '2026-11-03': { cena: 'Copia', comida: 'Copia' }, '2026-11-01': { cena: 'Solo copia' } },
  };
  const before = structuredClone(phone);
  const { state, added } = l.mergeBackup(phone, backup);
  assert.equal(added, 2);
  assert.deepEqual(state.log, {
    '2026-11-01': { cena: 'Solo copia' },
    '2026-11-03': { cena: 'Móvil', comida: 'Copia' },
    '2026-11-04': { cena: 'Solo móvil' },
  });
  assert.deepEqual(state.options.cena, ['Nueva']);
  assert.deepEqual(phone, before);
});

test('un archivo inválido se rechaza', () => {
  const ok = { app: 'comidas', v: 1, createdAt: '2026-11-03T00:00:00Z', options: l.emptyState().options, log: {} };
  assert.doesNotThrow(() => l.parseBackup(JSON.stringify(ok)));
  const bad = [
    'no json',
    'null',
    '{}',
    JSON.stringify({ ...ok, v: 2 }),
    JSON.stringify({ ...ok, app: 'otra' }),
    JSON.stringify({ ...ok, createdAt: 'ayer' }),
    JSON.stringify({ ...ok, options: { cena: 'Sopa' } }),
    JSON.stringify({ ...ok, prep: { cena: {} } }),
    JSON.stringify({ ...ok, tips: { cena: [] } }),
    JSON.stringify({ ...ok, details: { cena: {} } }),
    JSON.stringify({ ...ok, details: { desayuno: {}, comida: {}, merienda: {}, cena: { Sopa: 'calabaza' } } }),
    JSON.stringify({ ...ok, log: { ayer: {} } }),
    JSON.stringify({ ...ok, log: { '2026-11-03': { snack: 'Nueces' } } }),
    JSON.stringify({ ...ok, log: { '2026-11-03': { cena: 5 } } }),
    `{"app":"comidas","v":1,"createdAt":"2026-11-03T00:00:00Z","options":${JSON.stringify(ok.options)},"log":{"__proto__":{"cena":"x"}}}`,
  ];
  for (const text of bad) assert.throws(() => l.parseBackup(text), /copia válida/, text);
});

test('needsBackup avisa a los 7 días, y no si no hay nada que guardar', () => {
  const state = l.emptyState();
  const now = new Date('2026-11-10T12:00:00Z');
  assert.equal(l.needsBackup(state, now), false);
  l.setMeal(state.log, '2026-11-03', 'cena', 'Sopa');
  assert.equal(l.needsBackup(state, now), true);
  state.lastBackup = '2026-11-04T12:00:00Z';
  assert.equal(l.needsBackup(state, now), false);
  state.lastBackup = '2026-11-03T11:00:00Z';
  assert.equal(l.needsBackup(state, now), true);
});

test('pegar una pauta reemplaza solo las secciones que nombra', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ desayuno: 'Vieja\n- 1 unidad de A', cena: 'Sopa', consejos: 'Beber agua' }) };
  const r = l.applyPaste(state, '\n# Desayuno\nNueva\n# Comida\nPollo');
  assert.deepEqual(r.options.desayuno, ['Nueva']);
  assert.deepEqual(r.details.desayuno, {});
  assert.deepEqual(r.options.comida, ['Pollo']);
  assert.deepEqual(r.options.cena, ['Sopa']);
  assert.deepEqual(r.tips.consejos, ['Beber agua']);
});

test('pegar una pauta sin cabeceras válidas no se acepta', () => {
  assert.throws(() => l.applyPaste(l.emptyState(), 'Avena\nTostada'), /# Desayuno/);
  assert.throws(() => l.applyPaste(l.emptyState(), '# Snack\nNueces'), /Snack/);
  assert.throws(() => l.applyPaste(l.emptyState(), '# Cena\nSopa\n# Snack\nNueces'), /Snack/);
});

test('splitEmoji separa el emoji del nombre', () => {
  assert.deepEqual(l.splitEmoji('🍲 Sopa de la casa'), { emoji: '🍲', name: 'Sopa de la casa' });
  assert.deepEqual(l.splitEmoji('🌶️Picante'), { emoji: '🌶️', name: 'Picante' });
  assert.deepEqual(l.splitEmoji('🧑‍🍳 Receta'), { emoji: '🧑‍🍳', name: 'Receta' });
  assert.deepEqual(l.splitEmoji('Sopa'), { emoji: '', name: 'Sopa' });
  assert.deepEqual(l.splitEmoji('2 huevos'), { emoji: '', name: '2 huevos' });
});

test('splitQuantity separa la cantidad del ingrediente', () => {
  assert.deepEqual(l.splitQuantity('40 g de avena'), { qty: '40 g', name: 'avena' });
  assert.deepEqual(l.splitQuantity('100 ml de leche'), { qty: '100 ml', name: 'leche' });
  assert.deepEqual(l.splitQuantity('1 huevo + 100 g de claras'), { qty: '1', name: 'huevo + 100 g de claras' });
  assert.deepEqual(l.splitQuantity('2,5 kg de patata'), { qty: '2,5 kg', name: 'patata' });
  assert.deepEqual(l.splitQuantity('Canela al gusto'), { qty: '', name: 'Canela al gusto' });
  assert.deepEqual(l.splitQuantity('3 gambas'), { qty: '3', name: 'gambas' });
});

test('addWater suma, resta sin bajar de cero y no deja días vacíos', () => {
  const water = {};
  l.addWater(water, '2026-11-03', 250);
  l.addWater(water, '2026-11-03', 500);
  assert.equal(water['2026-11-03'], 750);
  l.addWater(water, '2026-11-03', -250);
  assert.equal(water['2026-11-03'], 500);
  l.addWater(water, '2026-11-03', -1000);
  assert.deepEqual(water, {});
});

test('formatLitres usa formato español', () => {
  assert.equal(l.formatLitres(0), '0 L');
  assert.equal(l.formatLitres(250), '0,25 L');
  assert.equal(l.formatLitres(1500), '1,5 L');
  assert.equal(l.formatLitres(2500), '2,5 L');
});

test('la copia guarda el agua y al restaurar gana lo que hay en el móvil', () => {
  const phone = l.emptyState();
  phone.water = { '2026-11-03': 500 };
  const other = l.emptyState();
  other.water = { '2026-11-03': 2000, '2026-11-01': 1000 };
  const back = l.parseBackup(JSON.stringify(l.makeBackup(other, new Date('2026-11-03T20:00:00Z'))));
  assert.deepEqual(l.mergeBackup(phone, back).state.water, { '2026-11-03': 500, '2026-11-01': 1000 });
  assert.deepEqual(phone.water, { '2026-11-03': 500 });
});

test('copias y datos antiguos sin agua siguen funcionando, y el agua inválida se rechaza', () => {
  const { options, log } = l.emptyState();
  assert.deepEqual(l.loadState(JSON.stringify({ options, log })).state.water, {});
  const old = { app: 'comidas', v: 1, createdAt: '2026-11-03T00:00:00Z', options, log };
  assert.deepEqual(l.mergeBackup(l.emptyState(), l.parseBackup(JSON.stringify(old))).state.water, {});
  for (const water of [{ ayer: 250 }, { '2026-11-03': '250' }, { '2026-11-03': -250 }, { '2026-11-03': 1.5 }, 'mucha']) {
    assert.throws(() => l.parseBackup(JSON.stringify({ ...old, water })), /copia válida/);
  }
});

test('needsBackup también protege el agua', () => {
  const state = l.emptyState();
  state.water = { '2026-11-03': 250 };
  assert.equal(l.needsBackup(state, new Date('2026-11-03T12:00:00Z')), true);
});

test('parseBoxes y formatBox conservan las calorías', () => {
  const r = l.parseBoxes({ cena: 'Sopa\n= 320 kcal\n- 1 unidad de A\nPescado\n=410\nSin datos' });
  assert.deepEqual(r.energy.cena, { Sopa: 320, Pescado: 410 });
  const state = { ...l.emptyState(), ...r };
  assert.equal(l.formatBox(state, 'cena'), 'Sopa\n= 320 kcal\n- 1 unidad de A\nPescado\n= 410 kcal\nSin datos');
  assert.deepEqual(l.parseBoxes({ cena: l.formatBox(state, 'cena') }).energy, r.energy);
});

test('unas calorías mal escritas no se aceptan', () => {
  assert.throws(() => l.parseBoxes({ cena: 'Sopa\n= mucho' }), /calorías/);
  assert.throws(() => l.parseBoxes({ cena: '= 300 kcal' }), /calorías/);
  assert.throws(() => l.parseBoxes({ cena: 'Sopa\n= -5 kcal' }), /calorías/);
});

test('el total del día suma lo marcado y cuenta lo que no tiene calorías', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ comida: 'Pollo\n= 500', cena: 'Sopa\n= 300' }) };
  const day = '2026-11-07';
  assert.deepEqual(l.dayKcal(state, day), { total: 0, counted: 0, missing: 0 });
  l.setMeal(state.log, day, 'comida', 'Pollo');
  l.setMeal(state.log, day, 'cena', 'Cheat meal: pizza');
  assert.equal(l.mealKcal(state, day, 'comida'), 500);
  assert.equal(l.mealKcal(state, day, 'cena'), null);
  assert.equal(l.mealKcal(state, day, 'desayuno'), null);
  assert.deepEqual(l.dayKcal(state, day), { total: 500, counted: 1, missing: 1 });
  l.setMeal(state.log, day, 'cena', 'Sopa');
  assert.deepEqual(l.dayKcal(state, day), { total: 800, counted: 2, missing: 0 });
});

test('una opción con 0 kcal cuenta como dato y no como falta', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Infusión\n= 0' }) };
  l.setMeal(state.log, '2026-11-03', 'cena', 'Infusión');
  assert.deepEqual(l.dayKcal(state, '2026-11-03'), { total: 0, counted: 1, missing: 0 });
});

test('una pauta nueva no cambia las calorías de los días pasados', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Sopa\n= 300' }) };
  l.setMeal(state.log, '2026-11-03', 'cena', 'Sopa');
  l.setMeal(state.log, '2026-11-04', 'cena', 'Sopa');
  l.setKcal(state.kcal, '2026-11-04', 'cena', 280);
  l.freezeKcal(state);
  Object.assign(state, l.parseBoxes({ cena: 'Sopa\n= 999\nOtra\n= 100' }));
  assert.equal(l.dayKcal(state, '2026-11-03').total, 300);
  assert.equal(l.dayKcal(state, '2026-11-04').total, 280);
});

test('setKcal limpia al quitar y la copia restaura solo las calorías de lo restaurado', () => {
  const kcal = {};
  l.setKcal(kcal, '2026-11-03', 'cena', 300);
  l.setKcal(kcal, '2026-11-03', 'cena', null);
  assert.deepEqual(kcal, {});

  const other = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Vieja\n= 700' }) };
  other.log = { '2026-11-03': { cena: 'Vieja' }, '2026-11-01': { cena: 'Vieja' } };
  other.kcal = { '2026-11-03': { cena: 700 }, '2026-11-01': { cena: 700 } };
  const back = l.parseBackup(JSON.stringify(l.makeBackup(other, new Date('2026-11-03T20:00:00Z'))));
  const phone = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Nueva\n= 200' }) };
  phone.log = { '2026-11-03': { cena: 'Nueva' } };
  phone.kcal = { '2026-11-03': { cena: 200 } };
  const { state } = l.mergeBackup(phone, back);
  assert.deepEqual(state.kcal, { '2026-11-03': { cena: 200 }, '2026-11-01': { cena: 700 } });
  assert.deepEqual(state.energy.cena, { Nueva: 200 });
  assert.deepEqual(l.mergeBackup(l.emptyState(), back).state.energy.cena, { Vieja: 700 });
});

test('datos sin calorías siguen funcionando y las calorías inválidas se rechazan', () => {
  const { options, log } = l.emptyState();
  const loaded = l.loadState(JSON.stringify({ options, log })).state;
  assert.deepEqual(loaded.kcal, {});
  assert.equal(l.energyOf(loaded, 'cena', 'Sopa'), null);
  const old = { app: 'comidas', v: 1, createdAt: '2026-11-03T00:00:00Z', options, log };
  for (const bad of [{ kcal: { ayer: {} } }, { kcal: { '2026-11-03': { snack: 1 } } }, { kcal: { '2026-11-03': { cena: -1 } } }, { energy: { cena: {} } }, { energy: { desayuno: {}, comida: {}, merienda: {}, cena: { Sopa: '300' } } }]) {
    assert.throws(() => l.parseBackup(JSON.stringify({ ...old, ...bad })), /copia válida/);
  }
});

const foodPlan = [
  '# Cena',
  'Fideos',
  '- 100 g de fideos de arroz',
  '- 50 ml de caldo',
  '- Sal al gusto',
  'Revuelto',
  '- 2 huevos + 100 g de claras',
  '- 1 kiwi',
  'Misterio',
  '- 100 g de ingrediente raro',
  '# Alimentos',
  'arroz = 300',
  'fideos de arroz = 360',
  'caldo = 10,5 kcal',
  'claras = 48',
  'huevo = 75 /ud',
  'kiwi = 45 /ud',
].join('\n');
const foodState = () => ({ ...l.emptyState(), ...l.parseBoxes({ desayuno: foodPlan }) });

test('los alimentos se leen de la pauta y se pueden volver a escribir', () => {
  const state = foodState();
  assert.deepEqual(state.foods.caldo, { kcal: 10.5, unit: '100' });
  assert.deepEqual(state.foods.huevo, { kcal: 75, unit: 'ud' });
  assert.equal(l.formatBox(state, 'alimentos').split('\n')[4], 'huevo = 75 /ud');
  const again = l.parseBoxes(Object.fromEntries(l.SECTIONS.map(s => [s, l.formatBox(state, s)])));
  assert.deepEqual(again.foods, state.foods);
  assert.throws(() => l.parseBoxes({ alimentos: 'arroz' }), /No entiendo el alimento/);
  assert.throws(() => l.parseBoxes({ alimentos: 'arroz = mucho' }), /No entiendo el alimento/);
});

test('cada parte de un ingrediente usa su alimento más concreto', () => {
  const state = foodState();
  assert.equal(l.foodFor(state, '100 g de fideos de arroz'), 'fideos de arroz');
  assert.deepEqual(l.partsOf('2 huevos + 100 g de claras'), ['2 huevos', '100 g de claras']);
  assert.equal(l.partKcal(state, '2 huevos').kcal, 150);
  assert.equal(l.partKcal(state, '100 g de claras').kcal, 48);
  assert.equal(l.partKcal(state, '100 g de ingrediente raro'), null);
  assert.equal(l.partKcal(state, 'Arroz al gusto'), null);
  assert.equal(l.partKcal(state, 'Un poco de arroz'), null);
});

test('las kcal de una opción salen de sus alimentos, con la de la pauta como reserva', () => {
  const state = foodState();
  assert.equal(l.optionKcal(state, 'cena', 'Fideos'), 365);
  assert.equal(l.optionKcal(state, 'cena', 'Revuelto'), 243);
  assert.equal(l.optionKcal(state, 'cena', 'Misterio'), null);
  assert.equal(l.optionKcal(state, 'cena', 'No existe'), null);
  const withFigure = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Sopa\n= 300' }) };
  assert.equal(l.optionKcal(withFigure, 'cena', 'Sopa'), 300);
});

test('los datos de un envase se convierten a kcal por 100 g', () => {
  assert.equal(l.packToPer100('500', '700'), 140);
  assert.equal(l.packToPer100('100', '152,5'), 152.5);
  assert.equal(l.packToPer100('250,5', '0'), 0);
  for (const [pack, kcal] of [['0', '700'], ['', '700'], ['500', ''], ['500', '-1'], ['abc', '700'], ['5', '700']]) {
    assert.equal(l.packToPer100(pack, kcal), null, `${pack}/${kcal}`);
  }
});

test('cambiar un alimento afecta a sus recetas y al día en curso, no a días pasados', () => {
  const state = foodState();
  l.setMeal(state.log, '2026-11-01', 'cena', 'Fideos');
  l.setMeal(state.log, '2026-11-03', 'cena', 'Fideos');
  l.setFoodEdit(state, 'caldo', { kcal: 110, unit: '100' }, '2026-11-03');
  assert.equal(l.mealKcal(state, '2026-11-01', 'cena'), 365);
  assert.equal(l.mealKcal(state, '2026-11-03', 'cena'), 415);
  assert.equal(l.optionKcal(state, 'cena', 'Fideos'), 415);
  l.setFoodEdit(state, 'caldo', null, '2026-11-03');
  assert.equal(l.mealKcal(state, '2026-11-01', 'cena'), 365);
  assert.equal(l.mealKcal(state, '2026-11-03', 'cena'), 365);
  assert.deepEqual(state.foodEdits, {});
});

test('un cheat meal en el día en curso sigue sin calorías al cambiar un alimento', () => {
  const state = foodState();
  l.setMeal(state.log, '2026-11-03', 'cena', 'Cheat meal: pizza');
  l.setFoodEdit(state, 'caldo', { kcal: 110, unit: '100' }, '2026-11-03');
  assert.equal(l.mealKcal(state, '2026-11-03', 'cena'), null);
});

test('una pauta nueva conserva los alimentos corregidos', () => {
  const state = foodState();
  l.setFoodEdit(state, 'caldo', { kcal: 110, unit: '100' }, '2026-11-03');
  Object.assign(state, l.applyPaste(state, '# Comida\nCrema\n- 100 g de caldo\n# Alimentos\ncaldo = 5'));
  assert.equal(state.foods.caldo.kcal, 5);
  assert.equal(l.optionKcal(state, 'comida', 'Crema'), 110);
});

test('la copia guarda los alimentos y al restaurar ganan los del móvil', () => {
  const other = foodState();
  other.foodEdits = { caldo: { kcal: 110, unit: '100' }, claras: { kcal: 50, unit: '100' } };
  const back = l.parseBackup(JSON.stringify(l.makeBackup(other, new Date('2026-11-03T20:00:00Z'))));
  const empty = l.mergeBackup(l.emptyState(), back).state;
  assert.deepEqual(empty.foods, other.foods);
  const phone = foodState();
  phone.foodEdits = { caldo: { kcal: 20, unit: '100' } };
  assert.deepEqual(l.mergeBackup(phone, back).state.foodEdits, { caldo: { kcal: 20, unit: '100' }, claras: { kcal: 50, unit: '100' } });
  const { options, log } = l.emptyState();
  const old = { app: 'comidas', v: 1, createdAt: '2026-11-03T00:00:00Z', options, log };
  assert.deepEqual(l.mergeBackup(l.emptyState(), l.parseBackup(JSON.stringify(old))).state.foodEdits, {});
  for (const bad of [{ foods: { a: { kcal: -1, unit: '100' } } }, { foods: { a: { kcal: 1, unit: 'kg' } } }, { foodEdits: { a: 5 } }, { foods: 'x' }]) {
    assert.throws(() => l.parseBackup(JSON.stringify({ ...old, ...bad })), /copia válida/);
  }
});

test('nombres raros de alimento no rompen nada', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Sopa\n- 100 g de constructor', alimentos: '__proto__ = 5\nconstructor = 100' }) };
  assert.equal(l.optionKcal(state, 'cena', 'Sopa'), 100);
  assert.equal({}.kcal, undefined);
});

test('una corrección sigue valiendo en la pauta siguiente aunque esta añada un alimento más corto', () => {
  const state = { ...l.emptyState(), ...l.parseBoxes({ cena: 'Plato\n- 10 g de aceite de oliva', alimentos: 'aceite de oliva = 900' }) };
  l.setFoodEdit(state, 'aceite de oliva', { kcal: 820, unit: '100' }, '2026-11-03');
  Object.assign(state, l.applyPaste(state, '# Cena\nNuevo\n- 10 g de aceite de oliva virgen\n- 10 g de aceite y sal\n# Alimentos\naceite de oliva = 900\naceite = 900'));
  assert.equal(l.partKcal(state, '10 g de aceite de oliva virgen').kcal, 82);
  assert.equal(l.partKcal(state, '10 g de aceite y sal').kcal, 90);
  assert.equal(l.optionKcal(state, 'cena', 'Nuevo'), 172);
});
