// A small, safe expression evaluator for the agent's calculator tool (no eval / Function).
// Supports + - * / % ^ **, parentheses, unary minus, constants pi/e and common functions.

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if (src.startsWith('**', i)) {
      out.push({ t: 'op', v: '^' });
      i += 2;
    } else if ('+-*/%^(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '×') {
      out.push({ t: 'op', v: '*' });
      i++;
    } else if (c === '÷') {
      out.push({ t: 'op', v: '/' });
      i++;
    } else {
      throw new Error(`unexpected character "${c}"`);
    }
  }
  return out;
}

export function evaluate(src: string): number {
  const toks = tokenize(src.replace(/,(?=\d{3}\b)/g, ''));
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && !(t.t === 'op' && t.v === v))) throw new Error(v ? `expected "${v}"` : 'unexpected end');
    p++;
    return t;
  };

  // precedence: + - < * / % < unary < ^ (right assoc) < atoms
  const expr = (): number => {
    let v = term();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        p++;
        const r = term();
        v = t.v === '+' ? v + r : v - r;
      } else return v;
    }
  };
  const term = (): number => {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        p++;
        const r = unary();
        v = t.v === '*' ? v * r : t.v === '/' ? v / r : v % r;
      } else return v;
    }
  };
  const unary = (): number => {
    const t = peek();
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      const v = unary();
      return t.v === '-' ? -v : v;
    }
    return power();
  };
  const power = (): number => {
    const base = atom();
    const t = peek();
    if (t?.t === 'op' && t.v === '^') {
      p++;
      return Math.pow(base, unary()); // right associative, allows 2^-1
    }
    return base;
  };
  const atom = (): number => {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') {
      p++;
      return t.v;
    }
    if (t.t === 'id') {
      p++;
      if (peek()?.t === 'op' && (peek() as any).v === '(') {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`unknown function "${t.v}"`);
        eat('(');
        const args: number[] = [];
        if (!(peek()?.t === 'op' && (peek() as any).v === ')')) {
          args.push(expr());
          while (peek()?.t === 'op' && (peek() as any).v === ',') {
            p++;
            args.push(expr());
          }
        }
        eat(')');
        return fn(...args);
      }
      if (t.v in CONSTS) return CONSTS[t.v];
      throw new Error(`unknown name "${t.v}"`);
    }
    if (t.v === '(') {
      p++;
      const v = expr();
      eat(')');
      return v;
    }
    throw new Error(`unexpected "${t.v}"`);
  };

  const v = expr();
  if (p < toks.length) throw new Error(`unexpected "${(toks[p] as any).v}"`);
  return v;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(parseFloat(n.toPrecision(12)));
}
