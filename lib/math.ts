import katex from 'katex';
import 'katex/dist/katex.min.css';
import { MATH_RE } from './mathSpeech';

export { latexToSpeech, speakableMath } from './mathSpeech';

// The AI writes formulas in LaTeX — \( … \) inline, \[ … \] (or $$ … $$)
// on their own line. Before this they showed up as raw source like
// "\[ f = \frac{c}{\lambda} \]". Single-$ delimiters are deliberately not
// supported: they collide with money amounts in ordinary text.

const PLACEHOLDER = (i: number) => `\u0000MATH${i}\u0000`;

/**
 * Pulls formulas out of markdown before it's escaped and formatted, so the
 * markdown steps can't mangle them (e.g. "*" or "_" inside a formula), and
 * pre-renders each one with KaTeX. Put them back with restoreMath() once
 * the rest of the text has been converted to HTML.
 */
export function extractMath(text: string): { text: string; rendered: string[] } {
  const rendered: string[] = [];
  const out = text.replace(MATH_RE, (_m, display: string | undefined, dollars: string | undefined, inline: string | undefined) => {
    const tex = (display ?? dollars ?? inline ?? '').trim();
    const displayMode = inline === undefined;
    let html: string;
    try {
      html = katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore', trust: false, output: 'html' });
    } catch {
      html = `<code>${tex.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</code>`;
    }
    rendered.push(displayMode ? `<span class="block my-2 overflow-x-auto overflow-y-hidden">${html}</span>` : html);
    return PLACEHOLDER(rendered.length - 1);
  });
  return { text: out, rendered };
}

export function restoreMath(html: string, rendered: string[]): string {
  if (rendered.length === 0) return html;
  return html.replace(/\u0000MATH(\d+)\u0000/g, (_m, i: string) => rendered[Number(i)] ?? '');
}
