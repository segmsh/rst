# @segmsh/rst

reStructuredText processor for [segm.sh](https://segm.sh). This package parses `.rst` files (including Sphinx documentation) into a document (AST + segments) and stringifies them back, treating prose as translatable segments while leaving everything else byte-for-byte intact.

## Installation

```bash
npm install @segmsh/rst
```

## Usage

```typescript
import RstProcessor from "@segmsh/rst";

const processor = new RstProcessor();

const content = "See `the docs <https://example.com>`_ for **details**.\n";
const document = processor.parse(content);
// document.segments[0].text === "See {reference0}the docs{/reference0} for {strong1}details{/strong1}."
// document.segments[0].tags === { reference0: { target: "https://example.com", suffix: "_" } }

// ... modify document segments ...

const newContent = processor.stringify(document);
```

## Features

- **Source Preservation**: Only blocks with changed text are rewritten; everything else is kept exactly as written.
- **Translatable Content**: Paragraphs, section titles, list items, field and definition lists, line blocks, block quotes, footnotes, admonitions and other prose directives, directive titles, `:alt:` and `:caption:` options, toctree entry titles, `replace::` substitutions and table cells.
- **Skipped Content**: Literal blocks, code and math directives, comments, targets, document metadata fields and unknown directives.
- **Inline Markup**: Emphasis, links, roles, substitutions and footnote references become `{tagN}...{/tagN}` markers. URLs and role targets are kept in `tags`, and renamed links keep pointing at their original target.
- **Layout**: Translations are re-wrapped like the original paragraph (same width and indentation, or one sentence per line), section underlines are resized and grid or simple tables are widened to fit.
- **Custom Directives**: Directives with translatable content can be added with `processor.parse(content, { proseDirectives: ["callout"] })`.
- **Round-trip**: Parsing and stringifying an unchanged document returns the original input.

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

Structure tests compare against [docutils](https://docutils.sourceforge.io/) and run when it is installed (`pip install docutils`); set `DOCUTILS_PYTHON` to use a specific Python interpreter.

## License

[Apache-2.0](LICENSE)
