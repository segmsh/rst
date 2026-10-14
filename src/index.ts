import {
  Document,
  Element,
  ElementContent,
  Processor,
  Root,
  Segment,
  SegmentRef,
  id,
  root,
  segment,
  text,
  visit,
} from "@segmsh/core";
import { scan, type Region, type ScanOptions } from "./blocks.js";
import { displayWidth, isTranslatable, parseInline, renderInline, targetName, unescape, type Content } from "./inline.js";
import { renderTable, type TableLayout } from "./tables.js";
import { wrap, type WrapStyle } from "./wrap.js";

export type RstParseOptions = ScanOptions & Record<string, unknown>;

// Text that would otherwise start a list, field, comment, ... gets an escaped first character
const BLOCK_START_REGEXP: RegExp =
  /^(?:[-+•‣⁃](?:\s|$)|\(?(?:\d+|#|[A-Za-z]|[ivxlcdmIVXLCDM]+)[.)](?:\s|$)|:[^:\s][^:]*:(?:\s|$)|(?:--?|\+|\/)\w|\.\.(?:\s|$)|__(?:\s|$)|>>>|([!-/:-@[-`{-~])\1{3,}$)/;

const contentOf = (current: Segment): Content =>
  current.tags ? { text: current.text, tags: current.tags } : { text: current.text };

const isChanged = (ref: string, segments: Map<string, Segment>): boolean => {
  const current = segments.get(ref);
  return !!current && id(contentOf(current)) !== ref;
};

const refsOf = (node: Element): string[] => {
  const refs: string[] = [];
  visit(node, "segment", (ref: SegmentRef) => {
    refs.push(ref.id);
  });
  return refs;
};

const eolOf = (value: string): string => (value.includes("\r\n") ? "\r\n" : "\n");

// Reference names compare case-insensitively with collapsed whitespace
const normalizeName = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

// Names used by references anywhere in the source: `Name`_, <Name_>, Name_
const referencedNames = (source: string): Set<string> => {
  const names = [
    // Interpreted text without an embedded target; escaped angle brackets belong to the name
    ...[...source.matchAll(/`((?:\\.|[^`\\])+?)`__?(?![\p{L}\p{N}])/gu)]
      .map((match) => match[1])
      .filter((name) => !/(?<!\\)</.test(name))
      .map(unescape),
    ...[...source.matchAll(/<([^<>]+?)_>/g)].map((match) => match[1]),
    ...[...source.matchAll(/(?<![\p{L}\p{N}`_])([\p{L}\p{N}]+(?:[-_.:+][\p{L}\p{N}]+)*)_(?![\p{L}\p{N}_])/gu)].map((match) => match[1]),
  ];

  return new Set(names.map(normalizeName));
};

// Names defined by explicit targets: .. _Name:
const explicitTargets = (source: string): Set<string> =>
  new Set(
    [...source.matchAll(/^[ \t]*\.\. _(?:`([^`]+)`|([^:`][^:]*?)):/gm)].map((match) => normalizeName(match[1] ?? match[2])),
  );

const visibleText = (content: Content): string => content.text.replace(/\{\/?[A-Za-z_][\w:.-]*?\d+\}/g, "");



const renderLine = (current: Segment, targets: string[]): string => {
  const rendered = renderInline({ ...contentOf(current), text: current.text.replace(/\s*\n\s*/g, " ") }, targets);
  return BLOCK_START_REGEXP.test(rendered) ? `\\${rendered}` : rendered;
};

export default class RstProcessor implements Processor<RstParseOptions> {
  parse(res: string, options?: RstParseOptions): Document {
    const segments = new Map<string, Segment>();
    const referenced = referencedNames(res);
    const explicit = explicitTargets(res);
    // Titles sharing a name were ambiguous link targets already
    const titleCounts = new Map<string, number>();

    // ".. default-role::" changes how bare `interpreted text` is read from that point on
    const defaultRoles = [...res.matchAll(/^[ \t]*\.\. +default-role::[ \t]*(\S*)/gm)].map((match) => ({
      position: match.index,
      role: match[1],
    }));
    const roleAt = (position: number): string =>
      defaultRoles.findLast((entry) => entry.position < position)?.role ?? "";

    scan(res, options).forEach((region) => {
      if (region.kind !== "title") return;
      const name = normalizeName(visibleText(parseInline(region.source)));
      titleCounts.set(name, (titleCounts.get(name) ?? 0) + 1);
    });

    // offset: position of a table cell's source within the document, for the default role
    const build = (source: string, offset?: number): Root["children"] => {
      const children: Root["children"] = [];
      let position = 0;

      const addSegment = (content: Content): SegmentRef => {
        const segId = id(content);
        if (!segments.has(segId)) segments.set(segId, { id: segId, ...content });
        return segment(segId);
      };

      const toNode = (region: Region): Element | null => {
        const raw = source.slice(region.start, region.end);

        if (region.kind === "table") {
          const cells = region.cells.map((cell) => build(cell, offset ?? region.start));
          const element: Element = {
            type: "element",
            tagName: "table",
            properties: { raw, layout: JSON.stringify(region.layout) },
            children: cells.map((children, index) => ({
              type: "element",
              tagName: "cell",
              properties: { index },
              children: children as ElementContent[],
            })),
          };

          return refsOf(element).length ? element : null;
        }

        const content = region.kind === "inline" && region.plain
          ? { text: region.source }
          : parseInline(region.source, roleAt(offset ?? region.start));

        // Named links whose name is reused elsewhere must keep defining it
        for (const [marker, tags] of Object.entries(content.tags ?? {})) {
          const inner = new RegExp(`\\{${marker}\\}([\\s\\S]*?)\\{/${marker}\\}`).exec(content.text)?.[1];

          if (tags.target && tags.suffix === "_" && inner && referenced.has(normalizeName(inner))) {
            tags.defines = inner;
          }
        }
        if (!isTranslatable(content)) return null;

        // A title linked to by name keeps that name as an explicit target once translated
        const name = region.kind === "title" ? visibleText(content).trim() : "";
        const anchor =
          name &&
          referenced.has(normalizeName(name)) &&
          !explicit.has(normalizeName(name)) &&
          titleCounts.get(normalizeName(name)) === 1;

        const properties: Element["properties"] =
          region.kind === "title"
            ? {
                raw,
                char: region.char,
                overline: region.overline,
                length: region.length,
                inset: region.inset,
                width: displayWidth(region.source),
                ...(anchor && { anchor: name }),
              }
            : {
                raw,
                ...(region.literal && { literal: true }),
                ...(region.plain && { plain: true }),
                ...(region.wrap && { wrap: JSON.stringify(region.wrap) }),
              };

        return {
          type: "element",
          tagName: region.kind,
          properties,
          children: [addSegment(content)],
        };
      };

      scan(source, options).forEach((region) => {
        if (region.start < position) return;

        const node = toNode(region);
        if (!node) return;

        if (region.start > position) children.push(text(source.slice(position, region.start)));
        children.push(node);
        position = region.end;
      });

      if (position < source.length) children.push(text(source.slice(position)));

      return children;
    };

    const children = build(res);

    return { tree: root(children), segments: [...segments.values()] };
  }

  stringify(document: Document): string {
    const segments = new Map<string, Segment>(
      document.segments.map((current) => [current.id, current]),
    );
    const targets: string[] = [];

    const render = (children: Root["children"]): string =>
      children
        .map((child) => {
          if (child.type === "text") return child.value;
          if (child.type !== "element") return "";

          const raw = String(child.properties.raw ?? "");
          const refs = refsOf(child);

          // Unchanged blocks keep their original source
          if (!refs.some((ref) => isChanged(ref, segments))) return raw;

          if (child.tagName === "table") {
            const layout = JSON.parse(String(child.properties.layout)) as TableLayout;
            const contents = child.children.map((cell) =>
              cell.type === "element" ? render(cell.children as Root["children"]) : "",
            );

            return renderTable(layout, contents, eolOf(raw));
          }

          const current = segments.get(refs[0])!;

          // Re-wraps the text like the original lines were wrapped
          const rewrap = (value: string): string => {
            if (!child.properties.wrap) return value;

            const style = JSON.parse(String(child.properties.wrap)) as WrapStyle;
            return wrap(value, style).join(eolOf(raw) + " ".repeat(style.indent));
          };

          if (child.properties.plain) return rewrap(current.text.replace(/\s*\n\s*/g, " "));

          const line = renderLine(current, targets);

          if (child.tagName === "title") {
            const { char, overline, length, inset, width } = child.properties;
            const title = " ".repeat(Number(inset)) + line;
            const titleWidth = displayWidth(title) + (overline ? Number(inset) : 0);
            // Underlines that matched the title keep matching, longer ones never get shorter
            const size = Number(length) === Number(width) + Number(inset) * (overline ? 2 : 1)
              ? titleWidth
              : Math.max(Number(length), titleWidth);
            const adornment = String(char).repeat(size);
            const eol = eolOf(raw);

            const target = child.properties.anchor
              ? `.. _${targetName(String(child.properties.anchor))}:${eol}${eol}`
              : "";

            return overline
              ? `${target}${adornment}${eol}${title}${eol}${adornment}`
              : `${target}${title}${eol}${adornment}`;
          }

          // Keep introducing the literal block: "Text:" becomes "Text::", other text gets " ::"
          if (child.properties.literal) {
            return rewrap(line.endsWith(":") && !line.endsWith("\\:") ? `${line}:` : `${line} ::`);
          }

          return rewrap(line);
        })
        .join("");

    const output = render(document.tree.children);

    if (!targets.length) return output;

    // Targets kept for renamed links go to the end, where they cannot disturb the layout
    const eol = eolOf(output);
    const ending = output.endsWith(eol) ? "" : eol;

    return `${output}${ending}${eol}${[...new Set(targets)].join(eol)}${eol}`;
  }
}
