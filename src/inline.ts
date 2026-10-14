import type { Tag } from "@segmsh/core";

export interface Content {
  text: string;
  tags?: Record<string, Tag>;
}

type Piece =
  | string
  | { name: string; tags?: Tag; inner?: string };

// Inline markup start/end-string recognition rules (docutils)
const START_PRECEDING: RegExp = /[\s\-:/'"<(\[{\u2018\u201c\u00ab]/;
const END_FOLLOWING: RegExp = /[\s\-.,:;!?\\/'")\]}>\u2019\u201d\u00bb]/;

const ROLE_REGEXP: RegExp = /^:([A-Za-z0-9](?:[\w.+:-]*[A-Za-z0-9])?):`/;
const SUFFIX_ROLE_REGEXP: RegExp = /^:([A-Za-z0-9](?:[\w.+:-]*[A-Za-z0-9])?):/;
const FOOTNOTE_REGEXP: RegExp = /^\[(#[\w.-]*|\*|\d+|[A-Za-z][\w.-]*)\]_/;
const SIMPLE_REFERENCE_REGEXP: RegExp =
  /^[\p{L}\p{N}]+(?:[-_.:+][\p{L}\p{N}]+)*(__|_)/u;
// "text <target>" or "<target>"; an escaped "\<" is not an embedded target
const EMBEDDED_TARGET_REGEXP: RegExp = /^(?:([\s\S]*?\S)\s+)?(?<!\\)<([^<>]+)>$/;

// Roles whose content is visible prose
const PROSE_ROLES: Set<string> = new Set([
  "abbr", "dfn", "emphasis", "guilabel", "menuselection", "strong", "sub",
  "subscript", "sup", "superscript", "t", "title", "title-reference",
]);

const MARKER_REGEXP: RegExp = /^(\/?)([A-Za-z_][\w:.-]*?)(\d+)$/;

const isStart = (value: string, index: number): boolean =>
  index === 0 || START_PRECEDING.test(value[index - 1]);

const isEnd = (value: string, index: number): boolean =>
  index >= value.length || END_FOLLOWING.test(value[index]);

const isSpace = (char: string | undefined): boolean =>
  char !== undefined && /\s/.test(char);

// Finds the end-string, honoring backslash escapes unless the content is literal
const findEnd = (
  value: string,
  from: number,
  end: string,
  options: { literal?: boolean; followed?: boolean } = {},
): number => {
  for (let j = from; j < value.length; j++) {
    if (!options.literal && value[j] === "\\") {
      j++;
      continue;
    }

    // Escaped whitespace ("\ ") does not count as whitespace before the end-string
    const precededBySpace = isSpace(value[j - 1]) && (options.literal || value[j - 2] !== "\\");

    if (
      value.startsWith(end, j) &&
      j > from &&
      !precededBySpace &&
      (options.followed === false || isEnd(value, j + end.length))
    ) {
      return j;
    }
  }

  return -1;
};

// Removes backslash escapes; escaped whitespace disappears
export const unescape = (value: string): string =>
  value.replace(/\\([\s\S]?)/g, (_match, char: string) =>
    isSpace(char) ? "" : char,
  );

const role = (name: string, raw: string): Piece => {
  const embedded = EMBEDDED_TARGET_REGEXP.exec(raw);

  if (embedded && embedded[1]?.trim() && !PROSE_ROLES.has(name)) {
    return { name, tags: { role: name, target: embedded[2] }, inner: unescape(embedded[1]) };
  }

  if (PROSE_ROLES.has(name)) {
    return { name, tags: { role: name }, inner: unescape(raw) };
  }

  // A glossary term is visible text that also names its entry
  if (name === "term") {
    return { name, tags: { role: name, name: raw }, inner: unescape(raw) };
  }

  return { name, tags: { role: name, content: raw } };
};

const reference = (raw: string, suffix: string): Piece => {
  const embedded = EMBEDDED_TARGET_REGEXP.exec(raw);

  if (embedded) {
    const tags = { target: embedded[2], suffix };

    return embedded[1]?.trim()
      ? { name: "reference", tags, inner: unescape(embedded[1]) }
      : { name: "reference", tags };
  }

  return {
    name: "reference",
    tags: suffix === "__" ? { suffix } : { name: raw, suffix },
    inner: unescape(raw),
  };
};

const tokenize = (value: string, defaultRole: string): Piece[] => {
  const pieces: Piece[] = [];
  let buffer = "";
  let i = 0;

  const push = (piece: Piece, next: number) => {
    if (buffer) pieces.push(unescape(buffer));
    buffer = "";
    pieces.push(piece);
    i = next;
  };

  while (i < value.length) {
    const char = value[i];

    if (char === "\\") {
      buffer += value.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (!isStart(value, i)) {
      buffer += char;
      i++;
      continue;
    }

    const rest = value.slice(i);

    if (rest.startsWith("``") && !isSpace(value[i + 2])) {
      const end = findEnd(value, i + 2, "``", { literal: true });

      if (end > 0) {
        push({ name: "literal", inner: value.slice(i + 2, end) }, end + 2);
        continue;
      }
    }

    if (rest.startsWith("**") && !isSpace(value[i + 2])) {
      const end = findEnd(value, i + 2, "**");

      if (end > 0) {
        push({ name: "strong", inner: unescape(value.slice(i + 2, end)) }, end + 2);
        continue;
      }
    }

    if (char === "*" && !rest.startsWith("**") && !isSpace(value[i + 1])) {
      const end = findEnd(value, i + 1, "*");

      if (end > 0) {
        push({ name: "emphasis", inner: unescape(value.slice(i + 1, end)) }, end + 1);
        continue;
      }
    }

    const roleMatch = ROLE_REGEXP.exec(rest);

    if (roleMatch && !isSpace(value[i + roleMatch[0].length])) {
      const start = i + roleMatch[0].length;
      const end = findEnd(value, start, "`");

      if (end > 0) {
        push(role(roleMatch[1], value.slice(start, end)), end + 1);
        continue;
      }
    }

    if (char === "`" && !isSpace(value[i + 1])) {
      const end = findEnd(value, i + 1, "`", { followed: false });

      if (end > 0) {
        const raw = value.slice(i + 1, end);
        const after = value.slice(end + 1);
        const suffixRole = SUFFIX_ROLE_REGEXP.exec(after);

        if (after.startsWith("__") && isEnd(value, end + 3)) {
          push(reference(raw, "__"), end + 3);
          continue;
        }

        if (after.startsWith("_") && isEnd(value, end + 2)) {
          push(reference(raw, "_"), end + 2);
          continue;
        }

        if (suffixRole && isEnd(value, end + 1 + suffixRole[0].length)) {
          push(role(suffixRole[1], raw), end + 1 + suffixRole[0].length);
          continue;
        }

        if (isEnd(value, end + 1)) {
          // Text in the default role: prose (title reference) unless the document chose e.g. math
          const piece: Piece = defaultRole && !PROSE_ROLES.has(defaultRole)
            ? { name: "interpreted", tags: { role: "", content: raw } }
            : { name: "interpreted", tags: { role: "" }, inner: unescape(raw) };

          push(piece, end + 1);
          continue;
        }
      }
    }

    if (char === "|" && !isSpace(value[i + 1])) {
      const end = findEnd(value, i + 1, "|", { followed: false });

      if (end > 0) {
        const suffix = /^__?/.exec(value.slice(end + 1))?.[0] ?? "";

        if (isEnd(value, end + 1 + suffix.length)) {
          const tags: Tag = { name: value.slice(i + 1, end) };
          if (suffix) tags.suffix = suffix;

          push({ name: "substitution", tags }, end + 1 + suffix.length);
          continue;
        }
      }
    }

    if (rest.startsWith("_`") && !isSpace(value[i + 2])) {
      const end = findEnd(value, i + 2, "`");

      if (end > 0) {
        push({ name: "target", tags: { name: value.slice(i + 2, end) } }, end + 1);
        continue;
      }
    }

    const footnote = FOOTNOTE_REGEXP.exec(rest);

    if (footnote && isEnd(value, i + footnote[0].length)) {
      push({ name: "footnote", tags: { label: footnote[1] } }, i + footnote[0].length);
      continue;
    }

    const simple = SIMPLE_REFERENCE_REGEXP.exec(rest);

    if (simple && isEnd(value, i + simple[0].length)) {
      const name = simple[0].slice(0, -simple[1].length);
      const tags: Tag = simple[1] === "__"
        ? { suffix: "__" }
        : { name, suffix: "_", simple: "true" };

      push({ name: "reference", tags, inner: name }, i + simple[0].length);
      continue;
    }

    // Skip the rest of a word, markup cannot start inside it
    const word = /^[\p{L}\p{N}]+/u.exec(rest);
    buffer += word ? word[0] : char;
    i += word ? word[0].length : 1;
  }

  if (buffer) pieces.push(unescape(buffer));

  return pieces;
};

// defaultRole: role set by a ".. default-role::" directive, if any
export const parseInline = (source: string, defaultRole = ""): Content => {
  const tags: Record<string, Tag> = {};
  let index = 0;

  const text = tokenize(source, defaultRole)
    .map((piece) => {
      if (typeof piece === "string") return piece;

      const key = `${piece.name}${index++}`;

      if (piece.tags) tags[key] = piece.tags;

      return piece.inner === undefined
        ? `{${key}}`
        : `{${key}}${piece.inner}{/${key}}`;
    })
    .join("");

  return Object.keys(tags).length ? { text, tags } : { text };
};

// True when nothing but markers and non-letter characters would be translated
export const isTranslatable = (content: Content): boolean =>
  /[\p{L}]/u.test(content.text.replace(/\{\/?[A-Za-z_][\w:.-]*?\d+\}/g, ""));

type MarkupNode = string | { marker: string; name: string; children: MarkupNode[]; closed: boolean };

const parseMarkers = (text: string): MarkupNode[] => {
  const stack: MarkupNode[] = [];
  const open = new Map<MarkupNode, string>();
  let buffer = "";

  for (let i = 0; i < text.length; i++) {
    const closingIndex = text[i] === "{" ? text.indexOf("}", i + 1) : -1;
    const marker = closingIndex > 0 ? text.substring(i + 1, closingIndex) : "";
    const match = marker ? MARKER_REGEXP.exec(marker) : null;

    if (!match) {
      buffer += text[i];
      continue;
    }

    if (buffer) stack.push(buffer);
    buffer = "";

    if (match[1]) {
      const openingIndex = stack.findLastIndex((node) => open.get(node) === marker.slice(1));

      // Unmatched closing marker: drop it and keep the content
      if (openingIndex >= 0) {
        const opening = stack[openingIndex] as Exclude<MarkupNode, string>;
        opening.children = stack.splice(openingIndex + 1);
        opening.closed = true;
        open.delete(opening);
      }
    } else {
      const node: MarkupNode = { marker, name: match[2], children: [], closed: false };
      open.set(node, marker);
      stack.push(node);
    }

    i = closingIndex;
  }

  if (buffer) stack.push(buffer);

  return stack;
};

// RST markup cannot nest, so nested markers are flattened to their text
const plainText = (nodes: MarkupNode[]): string =>
  nodes.map((node) => (typeof node === "string" ? node : plainText(node.children))).join("");

export const escapeText = (value: string): string =>
  value.replace(/[\\*`|]/g, "\\$&").replace(/_(?![\p{L}\p{N}])/gu, "\\_");

const escapeInterpreted = (value: string): string => value.replace(/[\\`<>]/g, "\\$&");

const renderMarkup = (
  name: string,
  tags: Tag | undefined,
  inner: string | undefined,
  targets: string[],
): string | null => {
  const role = tags?.role;

  // Roles first: role names like "literal" or "strong" match built-in marker names
  if (role !== undefined) return renderRole(role, tags!, inner);

  if (name === "strong" || name === "emphasis") {
    const delimiter = name === "strong" ? "**" : "*";
    return inner ? `${delimiter}${escapeText(inner)}${delimiter}` : null;
  }

  if (name === "literal") {
    return inner ? `\`\`${inner}\`\`` : null;
  }

  if (name === "substitution" && tags?.name) {
    return `|${tags.name}|${tags.suffix ?? ""}`;
  }

  if (name === "footnote" && tags?.label) {
    return `[${tags.label}]_`;
  }

  if (name === "target" && tags?.name) {
    return `_\`${tags.name}\``;
  }

  if (name === "reference" && tags) {
    const suffix = tags.suffix ?? "_";

    if (tags.target) {
      if (!inner) return `\`<${tags.target}>\`${suffix}`;

      // A link whose name is reused elsewhere keeps that name as a separate target
      if (tags.defines && tags.defines !== inner) {
        targets.push(`.. _${targetName(tags.defines)}: ${tags.target}`);
        return `\`${escapeInterpreted(inner)} <${tags.target}>\`__`;
      }

      return `\`${escapeInterpreted(inner)} <${tags.target}>\`${suffix}`;
    }

    if (!inner) return null;

    // Unchanged text keeps referring to its target by name
    if (tags.name !== undefined && unescape(tags.name) === inner) {
      return tags.simple ? `${inner}${suffix}` : `\`${tags.name}\`${suffix}`;
    }

    if (!tags.name) return `\`${escapeInterpreted(inner)}\`${suffix}`;

    // Names with angle brackets cannot be aliased: keep the original link text so the link works
    if (/[<>]/.test(unescape(tags.name))) {
      return tags.simple ? `${tags.name}${suffix}` : `\`${tags.name}\`${suffix}`;
    }

    // An alias keeps pointing at the original target (anonymous aliases would upset anonymous link order)
    return `\`${escapeInterpreted(inner)} <${tags.name}_>\`_`;
  }

  return null;
};

const renderRole = (role: string, tags: Tag, inner: string | undefined): string | null => {
  const prefix = role ? `:${role}:` : "";

  if (tags.target) {
    return inner ? `${prefix}\`${escapeInterpreted(inner)} <${tags.target}>\`` : null;
  }

  if (tags.content !== undefined) {
    return `${prefix}\`${tags.content}\``;
  }

  if (!inner) return null;

  if (tags.name !== undefined && tags.name !== inner) {
    return `${prefix}\`${escapeInterpreted(inner)} <${tags.name}>\``;
  }

  return `${prefix}\`${escapeInterpreted(inner)}\``;
};

// Target names with colons or backquotes, or starting with "_" (anonymous syntax), need backquotes
export const targetName = (name: string): string =>
  /[:`]|^_/.test(name) ? `\`${name.replace(/`/g, "\\`")}\`` : name;

// Renders markers back to RST; targets that must be defined separately are collected
export const renderInline = (content: Content, targets: string[] = []): string => {
  let result = "";

  const appendMarkup = (markup: string) => {
    // Inline markup must start after whitespace or punctuation
    if (result && !START_PRECEDING.test(result[result.length - 1])) {
      result += "\\ ";
    }

    result += markup;
  };

  const nodes = parseMarkers(content.text);

  nodes.forEach((node, index) => {
    if (typeof node === "string") {
      // ...and end before whitespace or punctuation
      const previous = nodes[index - 1];
      const needsSeparator =
        typeof previous === "object" && result.length > 0 && !isEnd(node, 0);

      result += (needsSeparator ? "\\ " : "") + escapeText(node);
      return;
    }

    const inner = node.closed || node.children.length ? plainText(node.children) : undefined;
    const trimmed = inner?.trim();
    const leading = inner && trimmed ? inner.slice(0, inner.indexOf(trimmed)) : "";
    const trailing = inner && trimmed ? inner.slice(inner.indexOf(trimmed) + trimmed.length) : "";
    const markup = renderMarkup(node.name, content.tags?.[node.marker], inner === undefined ? undefined : trimmed, targets);

    if (markup === null) {
      result += escapeText(inner ?? "");
      return;
    }

    result += escapeText(leading);
    appendMarkup(markup);
    result += escapeText(trailing);
  });

  return result;
};

const isWide = (code: number): boolean =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1faff) ||
  (code >= 0x20000 && code <= 0x3fffd);

// Column width as docutils measures it: wide East Asian characters count twice
export const displayWidth = (value: string): number => {
  let width = 0;

  for (const char of value) {
    const code = char.codePointAt(0)!;

    if (/\p{M}/u.test(char)) continue;
    width += isWide(code) ? 2 : 1;
  }

  return width;
};
