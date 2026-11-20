/**
 * A tiny, safe Markdown reader for the legal pages (`docs/legal/*.md` is the single source of the
 * text served at /privacy and /terms). It reads only the subset those files use and returns plain
 * data, so the page never injects HTML:
 *
 *   `#`, `##`, `###` headings · paragraphs (consecutive lines) · `- ` list items (continuation
 *   lines indented by two spaces) · `> ` notes · inline `**bold**`, `` `code` `` and
 *   `[text](href)` links (href: `/…`, `#…`, `https://…` or `mailto:…`; anything else stays text).
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; id: string }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'note'; inlines: Inline[] };

export interface LegalDoc {
  title: string;
  blocks: Block[];
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function isSafeHref(href: string): boolean {
  return (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('#') || href.startsWith('https://') || href.startsWith('mailto:');
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (node: Inline): void => {
    const last = out[out.length - 1];
    if (node.kind === 'text' && last?.kind === 'text') last.text += node.text;
    else if (node.kind !== 'text' || node.text) out.push(node);
  };
  let at = 0;
  for (const m of src.matchAll(INLINE)) {
    push({ kind: 'text', text: src.slice(at, m.index) });
    if (m[1] !== undefined) push({ kind: 'strong', text: m[1] });
    else if (m[2] !== undefined) push({ kind: 'code', text: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) push(isSafeHref(m[4]) ? { kind: 'link', text: m[3], href: m[4] } : { kind: 'text', text: m[3] });
    at = m.index + m[0].length;
  }
  push({ kind: 'text', text: src.slice(at) });
  return out;
}

/** GitHub-style heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function parseLegalMarkdown(md: string): LegalDoc {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let note: string[] = [];

  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'paragraph', inlines: parseInline(para.join(' ')) });
    if (list) blocks.push({ kind: 'list', items: list.map(parseInline) });
    if (note.length) blocks.push({ kind: 'note', inlines: parseInline(note.join(' ')) });
    para = [];
    list = null;
    note = [];
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flush();
      const text = heading[2]!.trim();
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text, id: slugify(text) });
      continue;
    }
    if (line.startsWith('- ')) {
      if (para.length || note.length) flush();
      (list ??= []).push(line.slice(2).trim());
      continue;
    }
    if (list && line.startsWith('  ')) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (line.startsWith('>')) {
      if (para.length || list) flush();
      note.push(line.replace(/^>\s?/, ''));
      continue;
    }
    if (list || note.length) flush();
    para.push(line.trim());
  }
  flush();

  const h1 = blocks.find((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading' && b.level === 1);
  return { title: h1?.text ?? '', blocks };
}
