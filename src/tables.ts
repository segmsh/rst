import type { Line } from "./blocks.js";
import { displayWidth } from "./inline.js";

interface GridCell {
  // Indices into the row and column boundary lists
  row: number;
  col: number;
  rowEnd: number;
  colEnd: number;
}

export interface GridLayout {
  kind: "grid";
  indent: number;
  rows: number[];
  cols: number[];
  // Row boundary drawn with "=" (end of the header), or -1
  header: number;
  cells: GridCell[];
}

interface SimpleRow {
  // Column ranges [first, last] of each cell; a range wider than one column spans
  spans: [number, number][];
  // Row followed by a "-----" line (column span underline)
  underline: boolean;
}

export interface SimpleLayout {
  kind: "simple";
  indent: number;
  columns: { start: number; width: number }[];
  // Number of header rows, or -1
  header: number;
  rows: SimpleRow[];
}

export type TableLayout = GridLayout | SimpleLayout;

export interface ParsedTable {
  end: number;
  layout: TableLayout;
  cells: string[];
}

const isBlank = (line: Line | undefined): boolean => !line || !line.text.trim();

// Splits a line into display columns; a wide character is followed by an empty filler
const toColumns = (text: string): string[] => {
  const columns: string[] = [];

  for (const char of text) {
    columns.push(char);
    if (displayWidth(char) === 2) columns.push("");
  }

  return columns;
};

// Strips the common indentation and surrounding blank lines of cell content
const normalizeCell = (lines: string[]): string => {
  const trimmed = lines.map((line) => line.trimEnd());
  const indents = trimmed
    .filter((line) => line.trim())
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;

  return trimmed
    .map((line) => line.slice(indent))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
};

export const parseGridTable = (
  lines: Line[],
  from: number,
  to: number,
  indent: number,
): ParsedTable | null => {
  let end = from;

  while (
    end < to &&
    !isBlank(lines[end]) &&
    /^[+|]/.test(lines[end].text.slice(indent))
  ) {
    end++;
  }

  const grid = lines.slice(from, end).map((line) => toColumns(line.text.slice(indent).trimEnd()));
  const bottom = grid.length - 1;
  const right = grid[0].length - 1;

  if (bottom < 2 || grid.some((row) => row.length !== right + 1) || grid[bottom][0] !== "+") {
    return null;
  }

  const at = (row: number, col: number): string => grid[row]?.[col] ?? "";

  const scanUp = (top: number, left: number, bottomRow: number): boolean => {
    for (let r = bottomRow - 1; r > top; r--) {
      if (!"|+".includes(at(r, left)) || !at(r, left)) return false;
    }
    return true;
  };

  const scanLeft = (top: number, left: number, bottomRow: number, rightCol: number): boolean => {
    for (let c = rightCol - 1; c > left; c--) {
      if (!"-=+".includes(at(bottomRow, c)) || !at(bottomRow, c)) return false;
    }
    return at(bottomRow, left) === "+" && scanUp(top, left, bottomRow);
  };

  const scanDown = (top: number, left: number, rightCol: number): number => {
    for (let r = top + 1; r <= bottom; r++) {
      const char = at(r, rightCol);

      if (char === "+") {
        if (scanLeft(top, left, r, rightCol)) return r;
      } else if (char !== "|") {
        return -1;
      }
    }
    return -1;
  };

  const scanCell = (top: number, left: number): [number, number] | null => {
    for (let c = left + 1; c <= right; c++) {
      const char = at(top, c);

      if (char === "+") {
        const bottomRow = scanDown(top, left, c);
        if (bottomRow >= 0) return [bottomRow, c];
      } else if (char !== "-" && char !== "=") {
        return null;
      }
    }
    return null;
  };

  const found: { top: number; left: number; bottom: number; right: number }[] = [];
  const covered = grid.map((row) => row.map(() => false));
  const visited = new Set<string>();
  const corners: [number, number][] = [[0, 0]];

  while (corners.length) {
    corners.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const [top, left] = corners.shift()!;
    const key = `${top},${left}`;

    if (visited.has(key) || top >= bottom || left >= right || covered[top + 1]?.[left + 1]) continue;
    visited.add(key);

    const cell = scanCell(top, left);
    if (!cell) continue;

    const [cellBottom, cellRight] = cell;
    found.push({ top, left, bottom: cellBottom, right: cellRight });

    for (let r = top + 1; r < cellBottom; r++) {
      for (let c = left + 1; c < cellRight; c++) covered[r][c] = true;
    }

    corners.push([top, cellRight], [cellBottom, left]);
  }

  // Every interior position must belong to a cell
  for (let r = 1; r < bottom; r++) {
    for (let c = 1; c < right; c++) {
      if (!covered[r][c] && !"+-=|".includes(at(r, c))) return null;
    }
  }

  if (!found.length) return null;

  const rows = [...new Set(found.flatMap((cell) => [cell.top, cell.bottom]))].sort((a, b) => a - b);
  const cols = [...new Set(found.flatMap((cell) => [cell.left, cell.right]))].sort((a, b) => a - b);
  const headerLine = grid.findIndex((row, index) => index > 0 && index < bottom && row[0] === "+" && row.includes("="));

  found.sort((a, b) => a.top - b.top || a.left - b.left);

  return {
    end,
    layout: {
      kind: "grid",
      indent,
      rows,
      cols,
      header: headerLine > 0 ? rows.indexOf(headerLine) : -1,
      cells: found.map((cell) => ({
        row: rows.indexOf(cell.top),
        col: cols.indexOf(cell.left),
        rowEnd: rows.indexOf(cell.bottom),
        colEnd: cols.indexOf(cell.right),
      })),
    },
    cells: found.map((cell) =>
      normalizeCell(
        grid
          .slice(cell.top + 1, cell.bottom)
          .map((row) => row.slice(cell.left + 1, cell.right).join("")),
      ),
    ),
  };
};

const SIMPLE_BORDER_REGEXP: RegExp = /^=+(?: +=+)*$/;

export const parseSimpleTable = (
  lines: Line[],
  from: number,
  to: number,
  indent: number,
): ParsedTable | null => {
  const border = lines[from].text.slice(indent).trimEnd();
  const columns = [...border.matchAll(/=+/g)].map((match) => ({
    start: match.index,
    width: match[0].length,
  }));
  const rows: { lines: string[]; spans: [number, number][]; underline: boolean }[] = [];
  const single = (): [number, number][] => columns.map((_column, index) => [index, index]);
  let header = -1;
  let end = -1;
  let previousBlank = false;

  for (let j = from + 1; j < to; j++) {
    const line = lines[j];

    if (isBlank(line)) {
      previousBlank = true;
      continue;
    }

    const text = toColumns(line.text.slice(indent).trimEnd());
    const plain = text.join("");

    if (SIMPLE_BORDER_REGEXP.test(plain)) {
      if (isBlank(lines[j + 1]) || j + 1 >= to) {
        end = j + 1;
        break;
      }

      header = rows.length;
      previousBlank = false;
      continue;
    }

    // Column span underline: each run of dashes covers the columns starting inside it
    if (/^-+(?: +-+)*$/.test(plain)) {
      const row = rows[rows.length - 1];
      if (!row) return null;

      const spans = [...plain.matchAll(/-+/g)].map((run): [number, number] => {
        const covered = columns
          .map((column, index) => ({ column, index }))
          .filter(({ column }) => column.start >= run.index && column.start < run.index + run[0].length);

        return covered.length ? [covered[0].index, covered[covered.length - 1].index] : [-1, -1];
      });

      // Runs must cover every column exactly once
      if (spans.some(([first]) => first < 0) || spans.flatMap(([a, b]) => b - a + 1).reduce((x, y) => x + y, 0) !== columns.length) {
        return null;
      }

      row.spans = spans;
      row.underline = true;
      previousBlank = false;
      continue;
    }

    if (rows.length && !previousBlank && !rows[rows.length - 1].underline && !text.slice(0, columns[1]?.start ?? text.length).join("").trim()) {
      rows[rows.length - 1].lines.push(plain);
    } else {
      rows.push({ lines: [plain], spans: single(), underline: false });
    }

    previousBlank = false;
  }

  if (end < 0 || !rows.length) return null;

  // Cells are cut once the spans of each row are known
  const cells = rows.flatMap((row) =>
    row.spans.map(([first, last]) => {
      const next = columns[last + 1];

      return normalizeCell(
        row.lines.map((value) => {
          const text = toColumns(value);
          return text.slice(columns[first].start, next ? next.start : text.length).join("");
        }),
      );
    }),
  );

  return {
    end,
    layout: {
      kind: "simple",
      indent,
      columns,
      header,
      rows: rows.map(({ spans, underline }) => ({ spans, underline })),
    },
    cells,
  };
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const renderGridTable = (layout: GridLayout, contents: string[]): string[] => {
  const widths = layout.cols.slice(1).map((col, index) => col - layout.cols[index] - 1);
  const heights = layout.rows.slice(1).map((row, index) => row - layout.rows[index] - 1);
  const contentLines = contents.map((content) => content.split("\n"));

  const order = layout.cells
    .map((cell, index) => ({ cell, index }))
    .sort((a, b) => a.cell.colEnd - a.cell.col - (b.cell.colEnd - b.cell.col) || a.cell.rowEnd - a.cell.row - (b.cell.rowEnd - b.cell.row));

  // Grow the last column/row a cell spans until its content fits
  order.forEach(({ cell, index }) => {
    const needWidth = Math.max(...contentLines[index].map(displayWidth)) + 2;
    const width = sum(widths.slice(cell.col, cell.colEnd)) + (cell.colEnd - cell.col - 1);
    if (needWidth > width) widths[cell.colEnd - 1] += needWidth - width;

    const needHeight = contentLines[index].length;
    const height = sum(heights.slice(cell.row, cell.rowEnd)) + (cell.rowEnd - cell.row - 1);
    if (needHeight > height) heights[cell.rowEnd - 1] += needHeight - height;
  });

  const x = [0];
  widths.forEach((width, index) => x.push(x[index] + width + 1));
  const y = [0];
  heights.forEach((height, index) => y.push(y[index] + height + 1));

  const canvas: string[][] = Array.from({ length: y[y.length - 1] + 1 }, () =>
    Array.from({ length: x[x.length - 1] + 1 }, () => " "),
  );

  layout.cells.forEach((cell, index) => {
    const [x0, x1, y0, y1] = [x[cell.col], x[cell.colEnd], y[cell.row], y[cell.rowEnd]];

    for (const [row, boundary] of [[y0, cell.row], [y1, cell.rowEnd]]) {
      const char = boundary === layout.header ? "=" : "-";
      for (let c = x0 + 1; c < x1; c++) canvas[row][c] = char;
    }

    for (let r = y0 + 1; r < y1; r++) {
      canvas[r][x0] = "|";
      canvas[r][x1] = "|";
    }

    contentLines[index].forEach((text, offset) => {
      toColumns(text).forEach((char, column) => {
        canvas[y0 + 1 + offset][x0 + 2 + column] = char;
      });
    });
  });

  // Corners last, so a spanning cell's edge never hides a neighbour's corner
  layout.cells.forEach((cell) => {
    for (const r of [y[cell.row], y[cell.rowEnd]]) {
      for (const c of [x[cell.col], x[cell.colEnd]]) canvas[r][c] = "+";
    }
  });

  return canvas.map((row) => " ".repeat(layout.indent) + row.join("").trimEnd());
};

const renderSimpleTable = (layout: SimpleLayout, contents: string[]): string[] => {
  const columns = layout.columns;
  const gaps = columns.slice(1).map((column, index) => column.start - columns[index].start - columns[index].width);
  const widths = columns.map((column) => column.width);

  // Cell lines per row; the first cell must stay on one line, a new row starts wherever it has text
  let offset = 0;
  const rows = layout.rows.map((row) =>
    row.spans.map((span, index) => {
      const content = contents[offset++];
      const lines = index === 0
        ? [content.replace(/\s*\n\s*/g, " ") || "\\"]
        : content ? content.split("\n") : [""];

      return { span, lines };
    }),
  );

  const spanWidth = ([first, lastColumn]: [number, number]): number =>
    sum(widths.slice(first, lastColumn + 1)) + sum(gaps.slice(first, lastColumn));

  // Single-column cells first, then spanning cells widen the last column they cover
  rows
    .flat()
    .sort((a, b) => a.span[1] - a.span[0] - (b.span[1] - b.span[0]))
    .forEach(({ span, lines }) => {
      const need = Math.max(...lines.map(displayWidth));
      const available = spanWidth(span);

      if (need > available) widths[span[1]] += need - available;
    });

  const x = columns.map((_column, index) => sum(widths.slice(0, index)) + sum(gaps.slice(0, index)));
  const place = (cells: { span: [number, number]; text: string }[]): string =>
    cells
      .reduce((line, { span, text }) => {
        const padded = line + " ".repeat(Math.max(0, x[span[0]] - displayWidth(line)));
        return padded + text;
      }, "")
      .trimEnd();

  const border = place(columns.map((_column, index) => ({ span: [index, index], text: "=".repeat(widths[index]) })));
  const result: string[] = [border];

  rows.forEach((cells, index) => {
    if (index === layout.header) result.push(border);

    const height = Math.max(...cells.map(({ lines }) => lines.length));

    for (let line = 0; line < height; line++) {
      result.push(place(cells.map(({ span, lines }) => ({ span, text: lines[line] ?? "" }))));
    }

    if (layout.rows[index].underline) {
      result.push(place(cells.map(({ span }) => ({ span, text: "-".repeat(spanWidth(span)) }))));
    }
  });

  if (layout.header === rows.length) result.push(border);
  result.push(border);

  return result.map((line) => " ".repeat(layout.indent) + line);
};

export const renderTable = (layout: TableLayout, contents: string[], eol: string): string =>
  (layout.kind === "grid" ? renderGridTable(layout, contents) : renderSimpleTable(layout, contents))
    .join(eol);
