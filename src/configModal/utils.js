// ============================================================
// Tracked event listeners
// ============================================================

let _listeners = [];

export function addTrackedListener(element, event, handler) {
  if (!element) return;
  element.addEventListener(event, handler);
  _listeners.push({ element, event, handler });
}

export function cleanupAllListeners() {
  _listeners.forEach(({ element, event, handler }) => {
    try { element.removeEventListener(event, handler); } catch { /* ignore */ }
  });
  _listeners = [];
}

// ============================================================
// Config JSON helpers
// ============================================================

/** Remove common leading indentation from a multiline string */
export function dedent(text) {
  const lines = text.split('\n');
  if (lines.length <= 1) return text;
  const indents = lines
    .filter(l => l.trim().length > 0)
    .map(l => l.match(/^(\s*)/)[1].length);
  const min = Math.min(...indents);
  if (min === 0) return text;
  return lines.map(l => l.length > min ? l.slice(min) : l).join('\n').trim();
}

export function dedentCommandList(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return commands;
  return dedent(commands.join('\n')).split('\n');
}

/**
 * Normalize commands after JSON parsing:
 * - arrays with a single multiline string -> split by line
 * - multiline string -> split
 */
export function normalizeCommands(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeCommands);
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (key === 'commands' || key === 'onupdate' || key === 'onclick' || key === 'onrightclick') {
        const v = obj[key];
        if (Array.isArray(v)) {
          if (v.length === 1 && typeof v[0] === 'string' && v[0].includes('\n')) {
            result[key] = v[0].split('\n').filter(l => l.trim() !== '');
          } else {
            result[key] = v;
          }
        } else if (typeof v === 'string' && v.includes('\n')) {
          result[key] = v.split('\n').filter(l => l.trim() !== '');
        } else {
          result[key] = v;
        }
      } else {
        result[key] = normalizeCommands(obj[key]);
      }
    }
    return result;
  }
  return obj;
}

export function normalizeCommandsForExport(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeCommandsForExport);
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      result[key] = normalizeCommandsForExport(obj[key]);
    }
    return result;
  }
  return obj;
}

export function formatConfig(config) {
  return JSON.stringify(normalizeCommandsForExport(config), null, 2);
}

export function parseConfig(text) {
  return normalizeCommands(JSON.parse(text));
}

// ============================================================
// Misc
// ============================================================

export function debounce(fn, wait = 200) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function maskSensitiveData(str, vis = 4) {
  if (!str || str.length <= vis * 2) return str;
  return `${str.slice(0, vis)}${'*'.repeat(Math.min(12, str.length - vis * 2))}${str.slice(-vis)}`;
}

export function truncated(str, len = 36) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}
