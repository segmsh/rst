import { parseGridTable, parseSimpleTable, type TableLayout } from "./tables.js";
import { detectWrapStyle, type WrapStyle } from "./wrap.js";

export interface Line {
  // Source offset of the line's first column
  start: number;
  text: string;
  // First line of a field, footnote or directive body: following lines may use another indent
  hanging?: boolean;
}

export interface InlineRegion {
  kind: "inline";
  start: number;
  end: number;
  source: string;
  // Paragraph ending with "::" that introduces a literal block
  literal?: boolean;
  // Plain text without inline markup (directive option values)
  plain?: boolean;
  // How the original text was broken into lines
  wrap?: WrapStyle;
}

export interface TitleRegion {
  kind: "title";
  start: number;
  end: number;
  source: string;
  char: string;
  overline: boolean;
  length: number;
  inset: number;
}

export interface TableRegion {
  kind: "table";
  start: number;
  end: number;
  layout: TableLayout;
  // Cell contents as standalone sources
  cells: string[];
}

export type Region = InlineRegion | TitleRegion | TableRegion;

export interface ScanOptions {
  // Additional directives whose content is translatable prose
  proseDirectives?: string[];
}

// Directives without arguments: text after "::" already belongs to the content
const ADMONITIONS: string[] = [
  "attention", "caution", "danger", "error", "hint", "important", "note",
  "seealso", "tip", "todo", "warning",
];

// Directives whose content is parsed as body elements
const BODY_DIRECTIVES: string[] = [
  ...ADMONITIONS, "admonition", "card", "centered", "class", "compound",
  "container", "deprecated", "dropdown", "epigraph", "figure", "glossary",
  "grid", "grid-item", "grid-item-card", "highlights", "hlist", "ifconfig",
  "list-table", "only", "pull-quote", "rst-class", "rubric", "sidebar", "tab",
  "tab-item", "tab-set", "table", "tabs", "topic", "versionadded",
  "versionchanged", "versionremoved",
];

// Directives whose argument is a visible title
const TITLE_DIRECTIVES: string[] = [
  "admonition", "card", "centered", "contents", "csv-table", "dropdown",
  "grid-item-card", "list-table", "rubric", "sidebar", "tab", "tab-item",
  "table", "title", "topic",
];

const TRANSLATABLE_OPTIONS: string[] = ["alt", "caption"];

const VERSION_DIRECTIVES: string[] = ["deprecated", "versionadded", "versionchanged", "versionremoved"];

const ADORNMENT_REGEXP: RegExp = /^([!-/:-@[-`{-~])\1*$/;
const GRID_TABLE_REGEXP: RegExp = /^\+(?:[-=]+\+)+$/;
const SIMPLE_TABLE_REGEXP: RegExp = /^=+(?: +=+)+$/;
const BULLET_REGEXP: RegExp = /^[-*+•‣⁃](?: +|$)/;
const ENUMERATOR_REGEXP: RegExp =
  /^(\(?)(\d+|#|[A-Za-z]|[ivxlcdmIVXLCDM]+)([.)])(?: +|$)/;
const FIELD_REGEXP: RegExp = /^:((?:\\.|[^:\\])+?):(?: +|$)/;
// Options: -a, --long, +x (X11 style) and /V (DOS style), with optional arguments
const OPTION_REGEXP: RegExp =
  /^(?:(?:--?|\+|\/)[\w-]+(?:[ =](?:<[^>]+>|[\w-]+))?)(?:, (?:--?|\+|\/)[\w-]+(?:[ =](?:<[^>]+>|[\w-]+))?)*(?: {2,}|$)/;
const DIRECTIVE_REGEXP: RegExp = /^\.\. +([\w:.+-]+)::(?: +|$)/;
const DIRECTIVE_OPTION_REGEXP: RegExp = /^:([\w-]+):(?: +|$)/;
const FOOTNOTE_REGEXP: RegExp = /^\.\. +\[[^\]\s]+\](?: +|$)/;
const SUBSTITUTION_REGEXP: RegExp = /^\.\. +\|[^|]+\| +([\w:.+-]+)::(?: +|$)/;
const TOCTREE_ENTRY_REGEXP: RegExp = /^(.*\S)\s+<[^<>]+>\s*$/;

export const splitLines = (source: string): Line[] => {
  const lines: Line[] = [];
  let start = 0;

  for (const match of source.matchAll(/\r?\n/g)) {
    lines.push({ start, text: source.slice(start, match.index) });
    start = match.index + match[0].length;
  }

  lines.push({ start, text: source.slice(start) });

  return lines;
};

const isBlank = (line: Line | undefined): boolean => !line || !line.text.trim();

const indentOf = (line: Line): number => line.text.length - line.text.trimStart().length;

const isAdornment = (text: string): boolean => ADORNMENT_REGEXP.test(text.trimEnd());

// Replaces a marker (bullet, field name, ...) with spaces so the rest parses as body
const mask = (lines: Line[], index: number, width: number): Line[] => {
  const masked = lines.slice();
  const line = lines[index];

  masked[index] = { start: line.start, text: " ".repeat(width) + line.text.slice(width), hanging: true };

  return masked;
};

// Bibliographic fields whose body is prose; others (author, version, ...) are metadata
const PROSE_FIELDS: string[] = ["abstract", "dedication"];

export class Scanner {
  readonly regions: Region[] = [];
  private readonly bodyDirectives: Set<string>;
  // A field list before any body content is document metadata (docinfo)
  private inDocinfo = true;

  constructor(private readonly lines: Line[], options: ScanOptions = {}) {
    this.bodyDirectives = new Set([...BODY_DIRECTIVES, ...(options.proseDirectives ?? [])]);
  }

  scan(): Region[] {
    this.parseBody(this.lines, 0, this.lines.length);
    return this.regions;
  }

  // Index after the last line indented at least minIndent (trailing blank lines excluded)
  private blockEnd(lines: Line[], from: number, to: number, minIndent: number): number {
    let last = from;

    for (let j = from + 1; j < to; j++) {
      if (isBlank(lines[j])) continue;
      if (indentOf(lines[j]) < minIndent) break;
      last = j;
    }

    return last + 1;
  }

  private addInline(
    lines: Line[],
    from: number,
    to: number,
    column: number,
    { literal = false, plain = false } = {},
  ) {
    const first = lines[from];
    const last = lines[to - 1];
    const start = first.start + column;
    const end = last.start + last.text.trimEnd().length;

    if (end <= start) return;

    let source = lines
      .slice(from, to)
      .map((line, index) => (index === 0 ? line.text.slice(column) : line.text).trim())
      .join(" ");

    // "Text::" shows "Text:", "Text ::" shows "Text"
    if (literal) {
      source = /\s::$/.test(source) ? source.slice(0, -3).trimEnd() : source.slice(0, -1);
    }

    const wrap = detectWrapStyle(
      lines.slice(from, to).map((line) => line.text),
      column,
      to - from > 1 ? indentOf(lines[from + 1]) : column,
    );

    this.regions.push({
      kind: "inline",
      start,
      end,
      source,
      ...(literal && { literal }),
      ...(plain && { plain }),
      ...(wrap && { wrap }),
    });
  }

  private parseBody(lines: Line[], from: number, to: number) {
    let i = from;

    while (i < to) {
      if (isBlank(lines[i])) {
        i++;
        continue;
      }

      const next = this.parseConstruct(lines, i, to);
      i = next > i ? next : i + 1;
    }
  }

  private parseConstruct(lines: Line[], i: number, to: number): number {
    const line = lines[i];
    const indent = indentOf(line);
    const text = line.text.slice(indent).trimEnd();

    if (/^\.\.(?:\s|$)/.test(text)) {
      return this.parseExplicit(lines, i, to, indent, text);
    }

    if (/^__(?:\s|$)/.test(text)) {
      return this.blockEnd(lines, i, to, indent + 1);
    }

    const title = this.parseTitle(lines, i, to, indent, text);
    if (title) return title;

    if (isAdornment(text) && text.length >= 4) {
      return i + 1;
    }

    if (GRID_TABLE_REGEXP.test(text)) {
      return this.parseTable(lines, i, to, indent, "grid");
    }

    if (SIMPLE_TABLE_REGEXP.test(text)) {
      return this.parseTable(lines, i, to, indent, "simple");
    }

    const bullet = BULLET_REGEXP.exec(text);
    if (bullet) {
      return this.parseItem(lines, i, to, indent, bullet[0].length);
    }

    const enumerator = ENUMERATOR_REGEXP.exec(text);
    if (enumerator && this.isEnumeratedItem(lines, i, to, indent, enumerator)) {
      return this.parseItem(lines, i, to, indent, enumerator[0].length);
    }

    const field = FIELD_REGEXP.exec(text);
    if (field) {
      if (this.inDocinfo && lines === this.lines && !PROSE_FIELDS.includes(field[1].toLowerCase())) {
        return this.blockEnd(lines, i, to, indent + 1);
      }

      return this.parseItem(lines, i, to, indent, field[0].length, indent + 1);
    }

    this.inDocinfo = false;

    const option = OPTION_REGEXP.exec(text);
    if (option) {
      return this.parseItem(lines, i, to, indent, option[0].length, indent + 1);
    }

    if (/^\|(?: +|$)/.test(text)) {
      return this.parseLineBlock(lines, i, to, indent);
    }

    if (/^>>>(?:\s|$)/.test(text)) {
      let j = i;
      while (j < to && !isBlank(lines[j])) j++;
      return j;
    }

    if (!isBlank(lines[i + 1]) && i + 1 < to && indentOf(lines[i + 1]) > indent) {
      // Definition list item: term followed by an indented definition
      this.addInline(lines, i, i + 1, indent);
      const end = this.blockEnd(lines, i, to, indent + 1);
      this.parseBody(lines, i + 1, end);
      return end;
    }

    return this.parseParagraph(lines, i, to, indent);
  }

  private parseTitle(lines: Line[], i: number, to: number, indent: number, text: string): number {
    const next = lines[i + 1];
    const afterNext = lines[i + 2];

    // Overline, title, underline
    if (
      indent === 0 &&
      isAdornment(text) &&
      i + 2 < to &&
      !isBlank(next) &&
      !isAdornment(next.text.trim()) &&
      afterNext.text.trimEnd() === text
    ) {
      const inset = indentOf(next);
      const source = next.text.trim();

      this.regions.push({
        kind: "title",
        start: lines[i].start,
        end: afterNext.start + afterNext.text.trimEnd().length,
        source,
        char: text[0],
        overline: true,
        length: text.length,
        inset,
      });

      return i + 3;
    }

    // Title, underline
    if (
      indent === 0 &&
      !isAdornment(text) &&
      i + 1 < to &&
      !isBlank(next) &&
      indentOf(next) === 0 &&
      isAdornment(next.text) &&
      next.text.trimEnd().length >= Math.min(4, text.length)
    ) {
      const underline = next.text.trimEnd();

      this.regions.push({
        kind: "title",
        start: lines[i].start,
        end: next.start + underline.length,
        source: text,
        char: underline[0],
        overline: false,
        length: underline.length,
        inset: 0,
      });

      return i + 2;
    }

    return 0;
  }

  private isEnumeratedItem(
    lines: Line[],
    i: number,
    to: number,
    indent: number,
    match: RegExpExecArray,
  ): boolean {
    if (match[1] === "(" && match[3] !== ")") return false;

    const next = lines[i + 1];

    // Otherwise "A. Lincoln was..." would start a list
    return (
      i + 1 >= to ||
      isBlank(next) ||
      indentOf(next) > indent ||
      ENUMERATOR_REGEXP.test(next.text.slice(indent))
    );
  }

  // List items, fields and options: a marker followed by an indented body
  private parseItem(
    lines: Line[],
    i: number,
    to: number,
    indent: number,
    markerWidth: number,
    minIndent?: number,
  ): number {
    const contentColumn = indent + markerWidth;
    const hasText = !!lines[i].text.slice(contentColumn).trim();
    let bodyIndent = minIndent ?? contentColumn;

    if (!hasText && minIndent === undefined) {
      const firstBodyLine = lines.slice(i + 1, to).find((line) => !isBlank(line));
      bodyIndent = firstBodyLine ? Math.max(indent + 1, indentOf(firstBodyLine)) : contentColumn;
    }

    const end = this.blockEnd(lines, i, to, bodyIndent);

    this.parseBody(mask(lines, i, contentColumn), i, end);

    return end;
  }

  private parseLineBlock(lines: Line[], i: number, to: number, indent: number): number {
    let j = i;

    while (j < to && !isBlank(lines[j]) && indentOf(lines[j]) === indent && lines[j].text[indent] === "|") {
      let end = j + 1;

      // Continuation lines are indented further
      while (end < to && !isBlank(lines[end]) && indentOf(lines[end]) > indent) end++;

      // Text starts after "|" and its spaces (extra spaces nest the line)
      const marker = /^\|\s*/.exec(lines[j].text.slice(indent))![0];

      if (lines[j].text.slice(indent + marker.length).trim()) {
        this.addInline(lines, j, end, indent + marker.length);
      }

      j = end;
    }

    return j;
  }

  private parseParagraph(lines: Line[], i: number, to: number, indent: number): number {
    const next = lines[i + 1];
    const hangingIndent =
      lines[i].hanging && i + 1 < to && !isBlank(next) && indentOf(next) < indent ? indentOf(next) : indent;
    let j = i + 1;

    while (j < to && !isBlank(lines[j]) && indentOf(lines[j]) === hangingIndent) j++;

    // Block quote attribution: the dash stays outside the translatable text
    const attribution = /^(?:---?|\u2014) +(?=\S)/.exec(lines[i].text.slice(indent));

    if (attribution) {
      this.addInline(lines, i, j, indent + attribution[0].length);
      return j;
    }

    const literal = lines[j - 1].text.trimEnd().endsWith("::");

    if (literal) {
      const paragraphText = lines.slice(i, j).map((line) => line.text.trim()).join(" ");

      if (paragraphText !== "::") {
        this.addInline(lines, i, j, indent, { literal: true });
      }

      return this.skipLiteral(lines, j, to, lines[i].hanging ? -1 : indent);
    }

    this.addInline(lines, i, j, indent);

    return j;
  }

  // Skips the literal block following "::": indented, or quoted with a repeated character.
  // After a field's or directive's first line (indent -1), the item's indented block is literal.
  private skipLiteral(lines: Line[], from: number, to: number, indent: number): number {
    let j = from;
    while (j < to && isBlank(lines[j])) j++;

    if (j >= to) return j;

    if (indentOf(lines[j]) > indent) {
      return this.blockEnd(lines, j, to, indent < 0 ? indentOf(lines[j]) : indent + 1);
    }

    const quote = lines[j].text[indent];

    if (indentOf(lines[j]) === indent && /[!-/:-@[-`{-~]/.test(quote)) {
      while (j < to && !isBlank(lines[j]) && lines[j].text[indent] === quote) j++;
    }

    return j;
  }

  private parseTable(lines: Line[], i: number, to: number, indent: number, kind: "grid" | "simple"): number {
    const parsed = kind === "grid"
      ? parseGridTable(lines, i, to, indent)
      : parseSimpleTable(lines, i, to, indent);

    if (!parsed) {
      let j = i;
      while (j < to && !isBlank(lines[j])) j++;
      return j;
    }

    const last = lines[parsed.end - 1];

    this.regions.push({
      kind: "table",
      start: lines[i].start,
      end: last.start + last.text.trimEnd().length,
      layout: parsed.layout,
      cells: parsed.cells,
    });

    return parsed.end;
  }

  private parseExplicit(lines: Line[], i: number, to: number, indent: number, text: string): number {
    const end = this.blockEnd(lines, i, to, indent + 1);

    const footnote = FOOTNOTE_REGEXP.exec(text);
    if (footnote) {
      this.parseBody(mask(lines, i, indent + footnote[0].length), i, end);
      return end;
    }

    const substitution = SUBSTITUTION_REGEXP.exec(text);
    if (substitution) {
      if (substitution[1] === "replace") {
        this.parseBody(mask(lines, i, indent + substitution[0].length), i, end);
      }
      return end;
    }

    const directive = DIRECTIVE_REGEXP.exec(text);
    if (directive) {
      this.parseDirective(lines, i, end, indent, directive[1].toLowerCase(), directive[0].length);
    }

    // Comments and hyperlink targets are not translatable
    return end;
  }

  private parseDirective(
    lines: Line[],
    i: number,
    end: number,
    indent: number,
    name: string,
    prefixWidth: number,
  ) {
    const argumentColumn = indent + prefixWidth;
    const hasArgument = !!lines[i].text.slice(argumentColumn).trim();
    const isBody = this.bodyDirectives.has(name) || name.includes(":");

    // Admonitions take no arguments: the first line already is content
    if (ADMONITIONS.includes(name) && hasArgument) {
      this.parseBody(mask(lines, i, argumentColumn), i, end);
      return;
    }

    let j = i + 1;

    // Argument continuation lines run until a blank line or an option
    if (!ADMONITIONS.includes(name)) {
      while (
        j < end &&
        !isBlank(lines[j]) &&
        !DIRECTIVE_OPTION_REGEXP.test(lines[j].text.trim())
      ) {
        j++;
      }

      if (VERSION_DIRECTIVES.includes(name)) {
        this.addVersionExplanation(lines, i, j, argumentColumn);
      } else if (hasArgument && TITLE_DIRECTIVES.includes(name)) {
        // The document title is metadata, not parsed for markup
        this.addInline(lines, i, j, argumentColumn, { plain: name === "title" });
      }
    }

    // Options, each with optional indented continuation lines
    while (j < end && !isBlank(lines[j])) {
      const optionIndent = indentOf(lines[j]);
      const option = DIRECTIVE_OPTION_REGEXP.exec(lines[j].text.slice(optionIndent));

      if (!option) break;

      let k = j + 1;
      while (k < end && !isBlank(lines[k]) && indentOf(lines[k]) > optionIndent) k++;

      if (TRANSLATABLE_OPTIONS.includes(option[1]) && lines[j].text.slice(optionIndent + option[0].length).trim()) {
        this.addInline(lines, j, k, optionIndent + option[0].length, { plain: true });
      }

      j = k;
    }

    if (name === "toctree") {
      this.parseToctree(lines, j, end);
    } else if (isBody) {
      this.parseBody(lines, j, end);
    }
  }

  // "versionadded:: 2.0 Explanation": everything after the version is translatable
  private addVersionExplanation(lines: Line[], i: number, j: number, argumentColumn: number) {
    const version = /^\S+\s*/.exec(lines[i].text.slice(argumentColumn))?.[0] ?? "";
    const firstLineHasText = !!lines[i].text.slice(argumentColumn + version.length).trim();

    if (firstLineHasText) {
      this.addInline(lines, i, j, argumentColumn + version.length);
    } else if (j > i + 1) {
      this.addInline(lines, i + 1, j, indentOf(lines[i + 1]));
    }
  }

  // Only explicit entry titles ("Title <document>") are translatable
  private parseToctree(lines: Line[], from: number, to: number) {
    for (let j = from; j < to; j++) {
      const indent = indentOf(lines[j]);
      const text = lines[j].text.slice(indent);
      const entry = TOCTREE_ENTRY_REGEXP.exec(text);

      if (!entry || text.startsWith(":")) continue;

      // Entry titles are plain text
      const start = lines[j].start + indent;
      this.regions.push({ kind: "inline", start, end: start + entry[1].length, source: entry[1], plain: true });
    }
  }
}

export const scan = (source: string, options?: ScanOptions): Region[] =>
  new Scanner(splitLines(source), options).scan().sort((a, b) => a.start - b.start);
