const MEALS = ['desayuno', 'comida', 'merienda', 'cena'];
const GENERAL = 'consejos';
const FOODS = 'alimentos';
const SECTIONS = [...MEALS, GENERAL, FOODS];
const CHEAT = 'Cheat meal';
const BACKUP_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const emptyOptions = () => ({ desayuno: [], comida: [], merienda: [], cena: [] });
const emptyDetails = () => ({ desayuno: {}, comida: {}, merienda: {}, cena: {} });
const emptyTips = () => ({ desayuno: [], comida: [], merienda: [], cena: [], consejos: [] });
const emptyState = () => ({
  options: emptyOptions(), details: emptyDetails(), prep: emptyDetails(), tips: emptyTips(), energy: emptyDetails(), foods: {}, foodEdits: {}, log: {}, kcal: {}, water: {}, lastBackup: null,
});

// Local time on purpose: toISOString() would put a late dinner on the wrong day.
function dateKey(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

function setMeal(log, key, meal, text) {
  if (text) {
    log[key] = log[key] || {};
    log[key][meal] = text;
  } else if (log[key]) {
    delete log[key][meal];
    if (!Object.keys(log[key]).length) delete log[key];
  }
}

// The kcal of a choice is kept with the day, so a later plan can't change past totals.
function setKcal(kcal, key, meal, value) {
  if (value !== null && value !== undefined) {
    kcal[key] = kcal[key] || {};
    kcal[key][meal] = value;
  } else if (kcal[key]) {
    delete kcal[key][meal];
    if (!Object.keys(kcal[key]).length) delete kcal[key];
  }
}

const energyOf = (state, meal, name) => (Object.hasOwn(state.energy[meal], name) ? state.energy[meal][name] : null);

// A line such as "1 huevo + 100 g de claras" holds one food per part.
const partsOf = line => line.split(/\s\+\s/);

const toNumber = text => (String(text).trim() ? Number(String(text).trim().replace(',', '.')) : NaN);

// A part belongs to the longest food name it contains, so "fideos de arroz" isn't "arroz".
function foodFor(state, part) {
  const text = normalize(part);
  return [...new Set([...Object.keys(state.foods), ...Object.keys(state.foodEdits)])]
    .filter(name => text.includes(normalize(name)))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

const foodValue = (state, food) => (Object.hasOwn(state.foodEdits, food) ? state.foodEdits[food] : state.foods[food]);

// Foods count per 100 g or ml, or per unit (unit "ud") when the plan gives pieces.
function partKcal(state, part) {
  if (/al gusto$/i.test(part)) return null;
  const food = foodFor(state, part);
  if (!food) return null;
  const { kcal, unit } = foodValue(state, food);
  const amount = unit === 'ud'
    ? part.match(/^(\d+(?:[.,]\d+)?)/)?.[1]
    : part.match(/(\d+(?:[.,]\d+)?)\s*(?:gr|g|ml)\b/i)?.[1];
  if (amount === undefined) return null;
  const quantity = toNumber(amount);
  return { food, unit, per: kcal, quantity, kcal: unit === 'ud' ? quantity * kcal : quantity * kcal / 100 };
}

// Ingredients with a known food win; "= N kcal" on the option is the fallback.
function optionKcal(state, meal, name) {
  const known = detailsOf(state.details, meal, name).flatMap(partsOf).map(part => partKcal(state, part)).filter(Boolean);
  return known.length ? Math.round(known.reduce((sum, p) => sum + p.kcal, 0)) : energyOf(state, meal, name);
}

function mealKcal(state, key, meal) {
  const chosen = state.log[key]?.[meal];
  if (!chosen) return null;
  return state.kcal[key]?.[meal] ?? optionKcal(state, meal, chosen);
}

// Past days keep their figures: only the given day takes the new value.
function setFoodEdit(state, food, value, day) {
  freezeKcal(state);
  if (value) state.foodEdits[food] = value;
  else delete state.foodEdits[food];
  for (const meal of Object.keys(state.log[day] || {})) {
    setKcal(state.kcal, day, meal, optionKcal(state, meal, state.log[day][meal]));
  }
}

// Weight and kcal of a pack, as read on its label, to kcal per 100 g. Null if they can't be right.
function packToPer100(pack, kcal) {
  const weight = toNumber(pack);
  const energy = toNumber(kcal);
  if (!(weight > 0) || !(energy >= 0)) return null;
  const per100 = Math.round(energy / weight * 1000) / 10;
  return per100 <= 950 ? per100 : null; // pure fat is about 900
}

// missing counts marked meals without a figure, such as a cheat meal.
function dayKcal(state, key) {
  const marked = MEALS.filter(m => state.log[key]?.[m]);
  const known = marked.map(m => mealKcal(state, key, m)).filter(v => v !== null);
  return { total: known.reduce((a, b) => a + b, 0), counted: known.length, missing: marked.length - known.length };
}

function freezeKcal(state) {
  for (const [key, day] of Object.entries(state.log)) {
    for (const meal of Object.keys(day)) setKcal(state.kcal, key, meal, mealKcal(state, key, meal));
  }
}

function addWater(water, key, ml) {
  const total = Math.max(0, (water[key] || 0) + ml);
  if (total) water[key] = total;
  else delete water[key];
}

const formatLitres = ml => `${(ml / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} L`;

const isCheat = text => text === CHEAT || (text || '').startsWith(CHEAT + ': ');
const cheatText = note => (note.trim() ? `${CHEAT}: ${note.trim()}` : CHEAT);
const cheatNote = text => (text || '').slice(CHEAT.length + 2);

const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Each box holds one option per line. Below an option, "- " lines are ingredients and
// "> " lines are preparation steps and "= 450 kcal" is its energy; "! " lines are tips for the whole meal.
// A "# Comida" line sends what follows to that section, so the whole plan can be pasted
// into one box and replace the sections it names.
function parseBoxes(boxes) {
  const named = {};
  const plain = {};
  const slot = (where, section) => (where[section] = where[section] || { items: new Map(), tips: [], foods: new Map() });
  for (const box of SECTIONS) {
    const lines = (boxes[box] || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const target = lines.some(l => l.startsWith('#')) ? named : plain;
    let current = box;
    let item = null;
    for (const line of lines) {
      if (line.startsWith('#')) {
        const header = normalize(line.replace(/^#+/, '').replace(/:$/, '').trim());
        if (!SECTIONS.includes(header)) throw new Error(`No reconozco la cabecera "${line}"`);
        current = header;
        slot(named, current);
        item = null;
        continue;
      }
      const section = slot(target, current);
      const text = line.replace(/^[-•*>!]\s*/, '');
      if (current === FOODS) {
        const food = text.match(/^(.+?)\s*=\s*(\d+(?:[.,]\d+)?)\s*(?:kcal)?\s*(\/\s*ud)?$/i);
        if (!food) throw new Error(`No entiendo el alimento "${line}"`);
        section.foods.set(food[1], { kcal: toNumber(food[2]), unit: food[3] ? 'ud' : '100' });
      } else if (current === GENERAL || line[0] === '!') {
        section.tips.push(text);
      } else if (line[0] === '=') {
        const energy = line.match(/^=\s*(\d+)\s*(?:kcal)?$/i);
        if (!energy || !item) throw new Error(`No entiendo las calorías "${line}"`);
        item.kcal = Number(energy[1]);
      } else if ('-•*'.includes(line[0]) && item) {
        item.ingredients.push(text);
      } else if (line[0] === '>' && item) {
        item.prep.push(text);
      } else {
        if (!section.items.has(text)) section.items.set(text, { ingredients: [], prep: [], kcal: null });
        item = section.items.get(text);
      }
    }
  }
  const result = { options: emptyOptions(), details: emptyDetails(), prep: emptyDetails(), tips: emptyTips(), energy: emptyDetails(), foods: {} };
  for (const box of SECTIONS) {
    const section = named[box] || plain[box];
    if (!section) continue;
    if (box === FOODS) {
      result.foods = Object.fromEntries(section.foods);
      continue;
    }
    result.tips[box] = section.tips;
    if (box === GENERAL) continue;
    const entries = [...section.items];
    result.options[box] = entries.map(([name]) => name);
    result.details[box] = Object.fromEntries(entries.filter(([, i]) => i.ingredients.length).map(([n, i]) => [n, i.ingredients]));
    result.prep[box] = Object.fromEntries(entries.filter(([, i]) => i.prep.length).map(([n, i]) => [n, i.prep]));
    result.energy[box] = Object.fromEntries(entries.filter(([, i]) => i.kcal !== null).map(([n, i]) => [n, i.kcal]));
  }
  return result;
}

// A plan pasted on its own replaces only the sections it names. Its text takes the place of
// the first named box because a box with headers would otherwise keep that box's old lines.
function applyPaste(state, text) {
  const header = text.match(/^\s*#+\s*(.+?):?\s*$/m);
  if (!header) throw new Error('Falta una línea de sección, como # Desayuno');
  const first = normalize(header[1]);
  if (!SECTIONS.includes(first)) throw new Error(`No reconozco la cabecera "${header[0].trim()}"`);
  const boxes = Object.fromEntries(SECTIONS.map(s => [s, formatBox(state, s)]));
  boxes[first] = text;
  return parseBoxes(boxes);
}

function splitEmoji(text) {
  const m = text.match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u);
  return m ? { emoji: m[1], name: m[2] } : { emoji: '', name: text };
}

function splitQuantity(line) {
  const m = line.match(/^(\d+(?:[.,]\d+)?(?:\s?(?:kg|gr|g|ml|l)\b)?)\s+(?:de\s+)?(.+)$/i);
  return m ? { qty: m[1], name: m[2] } : { qty: '', name: line };
}

const detailsOf = (details, meal, name) => (Object.hasOwn(details[meal], name) ? details[meal][name] : []);

function formatBox(state, box) {
  if (box === GENERAL) return state.tips[GENERAL].join('\n');
  if (box === FOODS) {
    return Object.entries(state.foods)
      .map(([name, { kcal, unit }]) => `${name} = ${kcal}${unit === 'ud' ? ' /ud' : ''}`).join('\n');
  }
  return [
    ...state.tips[box].map(tip => `! ${tip}`),
    ...state.options[box].flatMap(name => [
      name,
      ...(energyOf(state, box, name) === null ? [] : [`= ${energyOf(state, box, name)} kcal`]),
      ...detailsOf(state.details, box, name).map(line => `- ${line}`),
      ...detailsOf(state.prep, box, name).map(line => `> ${line}`),
    ]),
  ].join('\n');
}

const isTextList = v => Array.isArray(v) && v.every(s => typeof s === 'string');

function isValidDetails(details) {
  return details && typeof details === 'object' && MEALS.every(m =>
    details[m] && typeof details[m] === 'object' && Object.values(details[m]).every(isTextList));
}

const isValidTips = tips => tips && typeof tips === 'object' && [...MEALS, GENERAL].every(s => isTextList(tips[s]));
const isValidFoods = foods => foods && typeof foods === 'object' && Object.values(foods).every(f =>
  f && Number.isFinite(f.kcal) && f.kcal >= 0 && (f.unit === '100' || f.unit === 'ud'));

const isValidWater = water => water && typeof water === 'object' && Object.entries(water).every(([key, ml]) =>
  /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isInteger(ml) && ml > 0);

const isKcal = v => Number.isInteger(v) && v >= 0;
const isValidEnergy = energy => energy && typeof energy === 'object' && MEALS.every(m =>
  energy[m] && typeof energy[m] === 'object' && Object.values(energy[m]).every(isKcal));
const isValidKcal = kcal => kcal && typeof kcal === 'object' && Object.entries(kcal).every(([key, day]) =>
  /^\d{4}-\d{2}-\d{2}$/.test(key) && day && typeof day === 'object' &&
  Object.entries(day).every(([meal, v]) => MEALS.includes(meal) && isKcal(v)));

// details, prep, tips, energy, foods, foodEdits, kcal and water are optional: data saved by earlier versions doesn't have them.
function isValidData(d) {
  if (!d || typeof d.options !== 'object' || !d.options || typeof d.log !== 'object' || !d.log) return false;
  if (!MEALS.every(m => isTextList(d.options[m]))) return false;
  if (d.details !== undefined && !isValidDetails(d.details)) return false;
  if (d.prep !== undefined && !isValidDetails(d.prep)) return false;
  if (d.tips !== undefined && !isValidTips(d.tips)) return false;
  if (d.water !== undefined && !isValidWater(d.water)) return false;
  if (d.energy !== undefined && !isValidEnergy(d.energy)) return false;
  if (d.kcal !== undefined && !isValidKcal(d.kcal)) return false;
  if (d.foods !== undefined && !isValidFoods(d.foods)) return false;
  if (d.foodEdits !== undefined && !isValidFoods(d.foodEdits)) return false;
  return Object.entries(d.log).every(([key, day]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(key) && day && typeof day === 'object' &&
    Object.entries(day).every(([meal, text]) => MEALS.includes(meal) && typeof text === 'string' && text));
}

// Unreadable data is returned as `corrupt` so the caller can keep it instead of overwriting it.
function loadState(raw) {
  if (raw === null || raw === undefined) return { state: emptyState(), corrupt: null };
  try {
    const parsed = JSON.parse(raw);
    if (!isValidData(parsed)) throw new Error('invalid');
    return { state: { ...emptyState(), ...parsed }, corrupt: null };
  } catch {
    return { state: emptyState(), corrupt: raw };
  }
}

const makeBackup = (state, now) => ({
  app: 'comidas',
  v: 1,
  createdAt: now.toISOString(),
  options: state.options,
  details: state.details,
  prep: state.prep,
  tips: state.tips,
  energy: state.energy,
  foods: state.foods,
  foodEdits: state.foodEdits,
  log: state.log,
  kcal: state.kcal,
  water: state.water,
});

function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es una copia válida');
  }
  if (data?.app !== 'comidas' || data.v !== 1 || !isValidData(data) || Number.isNaN(Date.parse(data.createdAt))) {
    throw new Error('El archivo no es una copia válida');
  }
  return data;
}

// Restoring never deletes: on a conflict what is already on the phone wins.
function mergeBackup(state, backup) {
  const log = structuredClone(state.log);
  const kcal = structuredClone(state.kcal);
  let added = 0;
  for (const [key, day] of Object.entries(backup.log)) {
    for (const [meal, text] of Object.entries(day)) {
      if (log[key]?.[meal]) continue;
      setMeal(log, key, meal, text);
      setKcal(kcal, key, meal, backup.kcal?.[key]?.[meal]);
      added++;
    }
  }
  const hasOptions = MEALS.some(m => state.options[m].length);
  const newer = !state.lastBackup || Date.parse(backup.createdAt) > Date.parse(state.lastBackup);
  return {
    state: {
      options: hasOptions ? state.options : backup.options,
      details: hasOptions ? state.details : backup.details || emptyDetails(),
      prep: hasOptions ? state.prep : backup.prep || emptyDetails(),
      tips: hasOptions ? state.tips : backup.tips || emptyTips(),
      energy: hasOptions ? state.energy : backup.energy || emptyDetails(),
      foods: hasOptions ? state.foods : backup.foods || {},
      foodEdits: { ...backup.foodEdits, ...state.foodEdits },
      log,
      kcal,
      water: { ...backup.water, ...state.water },
      lastBackup: newer ? backup.createdAt : state.lastBackup,
    },
    added,
  };
}

function needsBackup(state, now) {
  if (!Object.keys(state.log).length && !Object.keys(state.water).length) return false;
  return !state.lastBackup || now - Date.parse(state.lastBackup) > BACKUP_EVERY_MS;
}

if (typeof module !== 'undefined') {
  module.exports = {
    MEALS, GENERAL, FOODS, SECTIONS, CHEAT, emptyState, dateKey, addDays, setMeal, setKcal, energyOf, mealKcal,
    partsOf, foodFor, partKcal, optionKcal, setFoodEdit, packToPer100, dayKcal, freezeKcal, addWater, formatLitres, isCheat, cheatText, cheatNote,
    parseBoxes, applyPaste, splitEmoji, splitQuantity, detailsOf, formatBox, loadState, makeBackup, parseBackup, mergeBackup, needsBackup,
  };
}
