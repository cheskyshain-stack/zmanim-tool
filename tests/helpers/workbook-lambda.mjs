// A small interpreter for the scalar Excel expressions used by the saved workbook
// fixture. It evaluates the original definitions, independently of the site's math.
// It deliberately rejects unsupported syntax rather than approximating a result.
export const omitted = Symbol('Excel omitted argument');
const normalize = name => name.replace(/^_(?:xlfn|xlpm|xlop)\./i, '').toLowerCase();
const epoch = Date.UTC(1899, 11, 30);
const precedence = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };

function parse(formula) {
  const tokens = formula.match(/"(?:[^"]|"")*"|(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[A-Za-z_][\w.]*(?:\[[\w]+\])?|<>|<=|>=|[()+\-*/^,=<>]/gi) || [];
  if (tokens.join('') !== formula.replace(/\s+/g, '')) throw new Error('Unsupported Excel syntax: ' + formula);
  let at = 0;
  const atom = () => {
    const t = tokens[at++];
    if (t === '+' || t === '-') return { unary: t, value: atom() };
    if (t === '(') { const value = expression(); if (tokens[at++] !== ')') throw new Error('Expected )'); return value; }
    if (/^(?:\d|\.)/.test(t)) return { literal: Number(t) };
    if (t?.startsWith('"')) return { literal: t.slice(1, -1).replace(/""/g, '"') };
    if (!t || !/^[A-Za-z_]/.test(t)) throw new Error('Expected a value: ' + t);
    const name = normalize(t);
    if (tokens[at] !== '(') return { name };
    at++;
    const args = [];
    if (tokens[at] !== ')') while (true) {
      args.push(tokens[at] === ',' || tokens[at] === ')' ? { literal: omitted } : expression());
      if (tokens[at] !== ',') break;
      at++;
    }
    if (tokens[at++] !== ')') throw new Error('Expected ) after ' + name);
    return { call: name, args };
  };
  const expression = (minimum = 0) => {
    let value = atom();
    while (precedence[tokens[at]] >= minimum) {
      const op = tokens[at++], right = expression(precedence[op] + (op === '^' ? 0 : 1));
      value = { op, left: value, right };
    }
    return value;
  };
  const result = expression();
  if (at !== tokens.length) throw new Error('Unparsed Excel tokens');
  return result;
}

export function workbookCalculator(fixture, settings) {
  const definitions = new Map(Object.entries(fixture.definedNames).map(([name, formula]) => [normalize(name), parse(formula)]));
  const globals = { true: true, false: false,
    constlatitude: settings.latitude, constlongitude: settings.longitude, constelevation: settings.elevation,
    consthorizon: -settings.horizon, consttimezone: settings.timezone.id,
    constuse_elevation: settings.useElevation, constuse_astronomical_chatzos: settings.useAstronomicalChatzos };
  for (const key of ['ZONE', 'UTC', 'DST', 'RULE']) globals['timezone_table[' + key.toLowerCase() + ']'] = fixture.timezones.map(zone => zone[key]);
  const functions = new Map();
  const builtins = {
    radians: n => n * Math.PI / 180, degrees: n => n * 180 / Math.PI,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    sum: (...numbers) => numbers.reduce((a, b) => a + b, 0), max: Math.max, min: Math.min,
    mod: (n, d) => ((n % d) + d) % d, and: (...values) => values.every(Boolean),
    year: serial => new Date(epoch + Math.floor(serial) * 86400000).getUTCFullYear(),
    date: (year, month, day) => (Date.UTC(year, month - 1, day) - epoch) / 86400000,
    today: () => Math.floor((Date.now() - epoch) / 86400000),
    index: (array, row) => array[row - 1],
    match: (needle, array, type) => { if (type !== 0) throw new Error('Only exact MATCH is supported'); const i = array.indexOf(needle); if (i < 0) throw new Error('No MATCH for ' + needle); return i + 1; },
    isomitted: value => value === omitted,
  };
  const lookup = (name, scope) => {
    if (name in scope) return scope[name];
    if (name in globals) return globals[name];
    if (name in builtins) return builtins[name];
    if (functions.has(name)) return functions.get(name);
    if (definitions.has(name)) { const fn = evaluate(definitions.get(name), {}); functions.set(name, fn); return fn; }
    throw new Error('Unknown workbook name: ' + name);
  };
  const evaluate = (node, scope) => {
    if ('literal' in node) return node.literal;
    if (node.name) return lookup(node.name, scope);
    if (node.unary) return (node.unary === '-' ? -1 : 1) * evaluate(node.value, scope);
    if (node.op) {
      const a = evaluate(node.left, scope), b = evaluate(node.right, scope);
      if (a === omitted || b === omitted) throw new Error('Omitted argument used in arithmetic');
      switch (node.op) {
        case '+': return Number(a) + Number(b); case '-': return a - b; case '*': return a * b;
        case '/': return a / b; case '^': return a ** b; case '=': return a === b; case '<>': return a !== b;
        case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
      }
    }
    const { call, args } = node;
    if (call === 'lambda') return (...values) => {
      const local = Object.create(scope);
      args.slice(0, -1).forEach((arg, i) => { if (!arg.name) throw new Error('Invalid LAMBDA parameter'); local[arg.name] = values[i] === undefined ? omitted : values[i]; });
      return evaluate(args.at(-1), local);
    };
    if (call === 'let') {
      const local = Object.create(scope);
      for (let i = 0; i < args.length - 1; i += 2) local[args[i].name] = evaluate(args[i + 1], local);
      return evaluate(args.at(-1), local);
    }
    if (call === 'if') return evaluate(evaluate(args[0], scope) ? args[1] : (args[2] || { literal: false }), scope);
    if (call === 'choose') return evaluate(args[evaluate(args[0], scope)], scope);
    if (call === 'map') {
      const values = args.slice(0, -1).map(arg => evaluate(arg, scope));
      if (values.some(Array.isArray)) throw new Error('Only scalar MAP is supported');
      return evaluate(args.at(-1), scope)(...values);
    }
    return lookup(call, scope)(...args.map(arg => evaluate(arg, scope)));
  };
  return (name, ...args) => lookup(normalize(name), {})(...args);
}
