const MEALS = ['desayuno', 'comida', 'merienda', 'cena'];
const CHEAT = 'Cheat meal';
const BACKUP_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

const emptyOptions = () => ({ desayuno: [], comida: [], merienda: [], cena: [] });
const emptyDetails = () => ({ desayuno: {}, comida: {}, merienda: {}, cena: {} });
const emptyState = () => ({ options: emptyOptions(), details: emptyDetails(), log: {}, lastBackup: null });

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

function toggle(log, key, meal, text) {
  setMeal(log, key, meal, log[key]?.[meal] === text ? null : text);
}

const isCheat = text => text === CHEAT || (text || '').startsWith(CHEAT + ': ');
const cheatText = note => (note.trim() ? `${CHEAT}: ${note.trim()}` : CHEAT);
const cheatNote = text => (text || '').slice(CHEAT.length + 2);

const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Each box holds one option per line, and "- " lines below an option are its ingredients.
// A "# Comida" line sends what follows to that meal, so the whole plan can be pasted
// into one box and replace the meals it names.
function parseBoxes(boxes) {
  const named = {};
  const plain = {};
  for (const meal of MEALS) {
    const lines = (boxes[meal] || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const target = lines.some(l => l.startsWith('#')) ? named : plain;
    let current = meal;
    let last = null;
    for (const line of lines) {
      if (line.startsWith('#')) {
        const header = normalize(line.replace(/^#+/, '').replace(/:$/, '').trim());
        if (!MEALS.includes(header)) throw new Error(`No reconozco la cabecera "${line}"`);
        current = header;
        named[current] = named[current] || new Map();
        last = null;
      } else {
        target[current] = target[current] || new Map();
        const text = line.replace(/^[-•*]\s*/, '');
        if (text !== line && last) {
          last.push(text);
        } else {
          if (!target[current].has(text)) target[current].set(text, []);
          last = target[current].get(text);
        }
      }
    }
  }
  const options = emptyOptions();
  const details = emptyDetails();
  for (const meal of MEALS) {
    const entries = [...(named[meal] || plain[meal] || [])];
    options[meal] = entries.map(([name]) => name);
    details[meal] = Object.fromEntries(entries.filter(([, lines]) => lines.length));
  }
  return { options, details };
}

const detailsOf = (details, meal, name) => (Object.hasOwn(details[meal], name) ? details[meal][name] : []);

const formatBox = (state, meal) => state.options[meal]
  .flatMap(name => [name, ...detailsOf(state.details, meal, name).map(line => `- ${line}`)])
  .join('\n');

const isTextList = v => Array.isArray(v) && v.every(s => typeof s === 'string');

function isValidDetails(details) {
  return details && typeof details === 'object' && MEALS.every(m =>
    details[m] && typeof details[m] === 'object' && Object.values(details[m]).every(isTextList));
}

function isValidData(d) {
  if (!d || typeof d.options !== 'object' || !d.options || typeof d.log !== 'object' || !d.log) return false;
  if (!MEALS.every(m => isTextList(d.options[m]))) return false;
  if (d.details !== undefined && !isValidDetails(d.details)) return false;
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
  app: 'comidas', v: 1, createdAt: now.toISOString(), options: state.options, details: state.details, log: state.log,
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
    MEALS, CHEAT, emptyState, dateKey, addDays, isWeekend, setMeal, toggle, isCheat, cheatText, cheatNote,
    parseBoxes, detailsOf, formatBox, loadState, makeBackup, parseBackup, mergeBackup, needsBackup,
  };
}
