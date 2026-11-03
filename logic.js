const MEALS = ['desayuno', 'comida', 'merienda', 'cena'];
const GENERAL = 'consejos';
const SECTIONS = [...MEALS, GENERAL];
const CHEAT = 'Cheat meal';
const BACKUP_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const emptyOptions = () => ({ desayuno: [], comida: [], merienda: [], cena: [] });
const emptyDetails = () => ({ desayuno: {}, comida: {}, merienda: {}, cena: {} });
const emptyTips = () => ({ desayuno: [], comida: [], merienda: [], cena: [], consejos: [] });
const emptyState = () => ({
  options: emptyOptions(), details: emptyDetails(), prep: emptyDetails(), tips: emptyTips(), log: {}, lastBackup: null,
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

function isWeekend(key) {
  const day = keyToDate(key).getDay();
  return day === 0 || day === 6;
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

const isCheat = text => text === CHEAT || (text || '').startsWith(CHEAT + ': ');
const cheatText = note => (note.trim() ? `${CHEAT}: ${note.trim()}` : CHEAT);
const cheatNote = text => (text || '').slice(CHEAT.length + 2);

const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Each box holds one option per line. Below an option, "- " lines are ingredients and
// "> " lines are preparation steps; "! " lines are tips for the whole meal.
// A "# Comida" line sends what follows to that section, so the whole plan can be pasted
// into one box and replace the sections it names.
function parseBoxes(boxes) {
  const named = {};
  const plain = {};
  const slot = (where, section) => (where[section] = where[section] || { items: new Map(), tips: [] });
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
      if (current === GENERAL || line[0] === '!') {
        section.tips.push(text);
      } else if ('-•*'.includes(line[0]) && item) {
        item.ingredients.push(text);
      } else if (line[0] === '>' && item) {
        item.prep.push(text);
      } else {
        if (!section.items.has(text)) section.items.set(text, { ingredients: [], prep: [] });
        item = section.items.get(text);
      }
    }
  }
  const result = { options: emptyOptions(), details: emptyDetails(), prep: emptyDetails(), tips: emptyTips() };
  for (const box of SECTIONS) {
    const section = named[box] || plain[box];
    if (!section) continue;
    result.tips[box] = section.tips;
    if (box === GENERAL) continue;
    const entries = [...section.items];
    result.options[box] = entries.map(([name]) => name);
    result.details[box] = Object.fromEntries(entries.filter(([, i]) => i.ingredients.length).map(([n, i]) => [n, i.ingredients]));
    result.prep[box] = Object.fromEntries(entries.filter(([, i]) => i.prep.length).map(([n, i]) => [n, i.prep]));
  }
  return result;
}

const detailsOf = (details, meal, name) => (Object.hasOwn(details[meal], name) ? details[meal][name] : []);

function formatBox(state, box) {
  if (box === GENERAL) return state.tips[GENERAL].join('\n');
  return [
    ...state.tips[box].map(tip => `! ${tip}`),
    ...state.options[box].flatMap(name => [
      name,
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

const isValidTips = tips => tips && typeof tips === 'object' && SECTIONS.every(s => isTextList(tips[s]));

// details, prep and tips are optional: data saved by earlier versions doesn't have them.
function isValidData(d) {
  if (!d || typeof d.options !== 'object' || !d.options || typeof d.log !== 'object' || !d.log) return false;
  if (!MEALS.every(m => isTextList(d.options[m]))) return false;
  if (d.details !== undefined && !isValidDetails(d.details)) return false;
  if (d.prep !== undefined && !isValidDetails(d.prep)) return false;
  if (d.tips !== undefined && !isValidTips(d.tips)) return false;
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
  log: state.log,
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
  let added = 0;
  for (const [key, day] of Object.entries(backup.log)) {
    for (const [meal, text] of Object.entries(day)) {
      if (log[key]?.[meal]) continue;
      setMeal(log, key, meal, text);
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
      log,
      lastBackup: newer ? backup.createdAt : state.lastBackup,
    },
    added,
  };
}

function needsBackup(state, now) {
  if (!Object.keys(state.log).length) return false;
  return !state.lastBackup || now - Date.parse(state.lastBackup) > BACKUP_EVERY_MS;
}

if (typeof module !== 'undefined') {
  module.exports = {
    MEALS, GENERAL, SECTIONS, CHEAT, emptyState, dateKey, addDays, isWeekend, setMeal, isCheat, cheatText, cheatNote,
    parseBoxes, detailsOf, formatBox, loadState, makeBackup, parseBackup, mergeBackup, needsBackup,
  };
}
