// LaTeX formulas in AI replies, turned into words for the voice. Kept
// separate from lib/math.ts so pages that only use speech don't pull in
// the KaTeX renderer.

// \( … \) inline, \[ … \] or $$ … $$ display. Single-$ is deliberately
// not supported: it collides with money amounts in ordinary text.
export const MATH_RE = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)/g;

// ── Reading formulas aloud ────────────────────────────────────────────────

const SPOKEN_COMMANDS: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon', theta: 'theta',
  lambda: 'lambda', mu: 'mu', pi: 'pi', rho: 'rho', sigma: 'sigma', tau: 'tau', phi: 'phi', omega: 'omega',
  Delta: 'delta', Sigma: 'sigma', Omega: 'omega', Theta: 'theta', Pi: 'pi',
  times: 'times', cdot: 'times', div: 'divided by', pm: 'plus or minus', mp: 'minus or plus',
  leq: 'is less than or equal to', le: 'is less than or equal to', geq: 'is greater than or equal to', ge: 'is greater than or equal to',
  neq: 'is not equal to', ne: 'is not equal to', approx: 'is approximately', equiv: 'is equivalent to',
  infty: 'infinity', sum: 'the sum of', prod: 'the product of', int: 'the integral of', lim: 'the limit of',
  log: 'log', ln: 'natural log', sin: 'sine', cos: 'cosine', tan: 'tangent', exp: 'e to the',
  to: 'to', rightarrow: 'gives', Rightarrow: 'implies', leftarrow: 'from', in: 'in', forall: 'for all',
  exists: 'there exists', land: 'and', lor: 'or', neg: 'not', cup: 'union', cap: 'intersection',
  subset: 'is a subset of', partial: 'partial', nabla: 'del', circ: 'degrees', ldots: 'and so on', dots: 'and so on',
};

/** Turns a LaTeX formula into words a text-to-speech voice can read. */
export function latexToSpeech(tex: string): string {
  let s = tex;
  // \text{…}, \mathrm{…} etc. keep their contents
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf)\s*\{([^{}]*)\}/g, ' $1 ');
  // Sums/products/integrals with limits: "the sum from i = 1 to n of …"
  const bigOps: Record<string, string> = { sum: 'sum', prod: 'product', int: 'integral' };
  s = s.replace(/\\(sum|prod|int)\s*_\s*(\{[^{}]*\}|\S)\s*\^\s*(\{[^{}]*\}|\S)/g,
    (_m, op: string, from: string, to: string) =>
      ` the ${bigOps[op]} from ${from.replace(/[{}]/g, '')} to ${to.replace(/[{}]/g, '')} of `);
  // Innermost-first so nested fractions/roots read correctly
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' ($1 over $2) ')
      .replace(/\\sqrt\s*\[([^{}\]]*)\]\s*\{([^{}]*)\}/g, ' the $1 root of ($2) ')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' the square root of ($1) ');
    if (s === before) break;
  }
  s = s
    .replace(/\^\s*\{?\s*2\s*\}?(?![\d])/g, ' squared ')
    .replace(/\^\s*\{?\s*3\s*\}?(?![\d])/g, ' cubed ')
    .replace(/\^\s*\{([^{}]*)\}/g, ' to the power of $1 ')
    .replace(/\^\s*(\S)/g, ' to the power of $1 ')
    .replace(/_\s*\{([^{}]*)\}/g, ' sub $1 ')
    .replace(/_\s*(\S)/g, ' sub $1 ')
    .replace(/\\(left|right|big|Big|bigg|Bigg)\b/g, '')
    .replace(/\\([a-zA-Z]+)/g, (_m, name: string) => ` ${SPOKEN_COMMANDS[name] ?? name} `)
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/<=/g, ' is less than or equal to ')
    .replace(/>=/g, ' is greater than or equal to ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    .replace(/(\S)\s*-\s*(\S)/g, '$1 minus $2')
    .replace(/(^|\s)-(\S)/g, '$1negative $2')
    .replace(/\*/g, ' times ')
    .replace(/\//g, ' over ')
    .replace(/</g, ' is less than ')
    .replace(/>/g, ' is greater than ')
    .replace(/[{}]/g, ' ')
    // Function notation: f(x) → "f of x", T(n) → "T of n", O(n log n) → "O of n log n"
    .replace(/(^|[^A-Za-z])([A-Zfgh])\(\s*([^()]+?)\s*\)/g, '$1$2 of $3')
    .replace(/\(\s*([^()\s]+)\s*\)/g, '$1') // drop brackets around a single term
    .replace(/[()]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s;
}

/** Replaces every formula in a passage with its spoken form. */
export function speakableMath(text: string): string {
  return text.replace(MATH_RE, (_m, display?: string, dollars?: string, inline?: string) =>
    ` ${latexToSpeech(display ?? dollars ?? inline ?? '')} `);
}
