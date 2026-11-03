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

test('isWeekend solo en sábado y domingo', () => {
  assert.equal(l.isWeekend('2026-11-06'), false);
  assert.equal(l.isWeekend('2026-11-07'), true);
  assert.equal(l.isWeekend('2026-11-08'), true);
  assert.equal(l.isWeekend('2026-11-09'), false);
});

test('toggle marca, cambia y desmarca sin dejar días vacíos', () => {
  const log = {};
  l.toggle(log, '2026-11-03', 'cena', 'Tortilla');
  assert.equal(log['2026-11-03'].cena, 'Tortilla');
  l.toggle(log, '2026-11-03', 'cena', 'Pescado');
  assert.equal(log['2026-11-03'].cena, 'Pescado');
  l.toggle(log, '2026-11-03', 'cena', 'Pescado');
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
  const o = l.parseBoxes({ desayuno: 'Avena\r\n\n- Tostada\nAvena', comida: '', merienda: '• Fruta', cena: 'Sopa' });
  assert.deepEqual(o, { desayuno: ['Avena', 'Tostada'], comida: [], merienda: ['Fruta'], cena: ['Sopa'] });
});

test('parseBoxes reparte la pauta pegada y reemplaza lo anterior', () => {
  const pasted = '# Desayuno\nAvena\n# COMIDA:\nPollo\n## Merienda\nFruta\n# Cena\nSopa';
  const o = l.parseBoxes({ desayuno: pasted, comida: 'Vieja', merienda: 'Vieja', cena: 'Vieja' });
  assert.deepEqual(o, { desayuno: ['Avena'], comida: ['Pollo'], merienda: ['Fruta'], cena: ['Sopa'] });
});

test('parseBoxes conserva los cuadros que la pauta pegada no nombra', () => {
  const o = l.parseBoxes({ desayuno: '# Cena\nSopa', comida: 'Pollo', merienda: '', cena: 'Vieja' });
  assert.deepEqual(o.cena, ['Sopa']);
  assert.deepEqual(o.comida, ['Pollo']);
});

test('parseBoxes rechaza cabeceras desconocidas', () => {
  assert.throws(() => l.parseBoxes({ desayuno: '# Snack\nNueces' }), /Snack/);
});

test('cambiar la pauta no altera el historial', () => {
  const state = l.emptyState();
  state.options.cena = ['Sopa'];
  l.toggle(state.log, '2026-11-03', 'cena', 'Sopa');
  state.options = l.parseBoxes({ cena: 'Tortilla' });
  assert.equal(state.log['2026-11-03'].cena, 'Sopa');
});

test('loadState conserva los datos ilegibles para no sobrescribirlos', () => {
  assert.equal(l.loadState(null).corrupt, null);
  assert.equal(l.loadState('{roto').corrupt, '{roto');
  assert.equal(l.loadState('{"options":{},"log":{}}').corrupt, '{"options":{},"log":{}}');
  const good = JSON.stringify(l.emptyState());
  assert.equal(l.loadState(good).corrupt, null);
});

test('copia de ida y vuelta', () => {
  const state = l.emptyState();
  state.options.cena = ['Sopa'];
  l.toggle(state.log, '2026-11-03', 'cena', 'Sopa');
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
  l.toggle(state.log, '2026-11-03', 'cena', 'Sopa');
  assert.equal(l.needsBackup(state, now), true);
  state.lastBackup = '2026-11-04T12:00:00Z';
  assert.equal(l.needsBackup(state, now), false);
  state.lastBackup = '2026-11-03T11:00:00Z';
  assert.equal(l.needsBackup(state, now), true);
});
