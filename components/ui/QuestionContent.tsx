// AI-generated questions sometimes reference a data table by name (e.g.
// "In the given ENROLLMENT_RECORD table...") and are instructed to embed
// its actual rows as a markdown table right inside question_text/
// explanation (see the generation prompt) — but every place that text
// gets shown was plain string interpolation, so the table just never
// appeared (or would have rendered as raw "| a | b |" text). This parses
// out markdown table blocks and renders them properly; everything else
// stays plain text.

interface TextBlock {
  type: 'text';
  content: string;
}

interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

type ContentBlock = TextBlock | TableBlock;

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
// A markdown table separator row, e.g. "|---|:---:|---|" or "| - | - |"
const isSeparatorRow = (line: string) =>
  /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line);

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function parseBlocks(text: string): ContentBlock[] {
  const lines = text.split('\n');
  const blocks: ContentBlock[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    const content = textBuffer.join('\n').trim();
    if (content) blocks.push({ type: 'text', content });
    textBuffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushText();
      const headers = splitRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }
    textBuffer.push(lines[i]);
    i++;
  }
  flushText();
  return blocks;
}

interface Props {
  text: string;
  className?: string;
  textClassName?: string;
}

export function QuestionContent({ text, className, textClassName }: Props) {
  const blocks = parseBlocks(text);

  // Common case: no table at all — skip the wrapper markup entirely so
  // this is a drop-in replacement for the old plain-string interpolation.
  if (blocks.length <= 1 && blocks[0]?.type === 'text') {
    return <span className={textClassName ?? className}>{text}</span>;
  }

  return (
    <div className={className}>
      {blocks.map((block, idx) =>
        block.type === 'text' ? (
          <p key={idx} className={`whitespace-pre-wrap ${textClassName ?? ''} ${idx > 0 ? 'mt-3' : ''}`}>
            {block.content}
          </p>
        ) : (
          <div key={idx} className="my-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 dark:bg-white/[0.05]">
                <tr>
                  {block.headers.map((h, hi) => (
                    <th
                      key={hi}
                      className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-white/10 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 1 ? 'bg-gray-50/60 dark:bg-white/[0.02]' : ''}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-white/5 whitespace-nowrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
