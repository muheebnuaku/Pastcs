// Shared table support for the app's hand-rolled markdown-to-HTML
// converters (AI Tutor chat and the results page's AI Explain panel —
// see mdToHtml in each). Neither ever handled markdown tables, so an AI
// response containing one just showed raw "| a | b |" text — the same
// gap the question-rendering fix (components/ui/QuestionContent.tsx)
// closed for generated questions.
//
// Call this FIRST, before any other line-based transform (headers,
// lists, the `\n{2,}` / `\n` paragraph-collapsing steps) — it depends on
// the original newline structure between a table's rows, which those
// later steps would otherwise destroy.
export function renderMarkdownTables(text: string): string {
  return text.replace(
    /^(\|.*\|)[ \t]*\n(\|[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?)[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/gm,
    (_match, headerLine: string, _sepLine: string, bodyLines: string) => {
      const splitRow = (line: string) =>
        line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

      const headers = splitRow(headerLine);
      const rows = bodyLines.trim().split('\n').map(splitRow);

      const theadCells = headers
        .map(h => `<th class="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-white/10 whitespace-nowrap">${h}</th>`)
        .join('');
      const tbodyRows = rows
        .map((row, i) => `<tr${i % 2 === 1 ? ' class="bg-gray-50/60 dark:bg-white/[0.02]"' : ''}>${row
          .map(c => `<td class="px-3 py-2 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-white/5 whitespace-nowrap">${c}</td>`)
          .join('')}</tr>`)
        .join('');

      return `<div class="my-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10"><table class="w-full text-sm border-collapse"><thead class="bg-gray-50 dark:bg-white/[0.05]"><tr>${theadCells}</tr></thead><tbody>${tbodyRows}</tbody></table></div>`;
    }
  );
}
