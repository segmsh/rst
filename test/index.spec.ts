import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { assert, describe, it } from "vitest";
import RstProcessor from "../src";

const processor = new RstProcessor();

const fixtures = fs
  .readdirSync(path.join("test", "fixtures"))
  .filter((filename) => filename.endsWith(".rst"));

const python = process.env.DOCUTILS_PYTHON ?? "python3";
const hasDocutils = spawnSync(python, ["-c", "import docutils"]).status === 0;

interface Doctree {
  signature: string[];
  text: string;
}

function readFixture(filename: string): string {
  return fs.readFileSync(path.join("test", "fixtures", filename), { encoding: "utf-8" });
}

// Parses RST with docutils, the reference implementation
function doctree(source: string): Doctree {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "segmsh-rst-")), "input.rst");
  fs.writeFileSync(file, source);

  const result = spawnSync(python, [path.join("test", "docutils_check.py"), file], { encoding: "utf-8" });

  if (result.status !== 0) throw new Error(result.stderr);

  return JSON.parse(result.stdout);
}

const MARKER_SPLIT_REGEXP: RegExp = /(\{\/?[A-Za-z_][\w:.-]*?\d+\})/;

// Applies a function to text outside markers
function mapText(text: string, map: (piece: string, index: number) => string): string {
  let depth = 0;
  let index = 0;

  return text
    .split(MARKER_SPLIT_REGEXP)
    .map((part) => {
      if (MARKER_SPLIT_REGEXP.test(part)) {
        if (part.startsWith("{/")) depth--;
        else if (/^\{(strong|emphasis|literal|reference|interpreted|[\w:.-]+)\d+\}$/.test(part)) {
          // Void markers have no closing counterpart; only paired ones change the depth
          if (text.includes(`{/${part.slice(1)}`)) depth++;
        }
        return part;
      }

      return depth === 0 && part ? map(part, index++) : part;
    })
    .join("");
}

const visible = (text: string): string[] =>
  text
    .split(MARKER_SPLIT_REGEXP)
    .filter((part) => !MARKER_SPLIT_REGEXP.test(part))
    // Definition list classifiers ("term : classifier") render as separate text
    .flatMap((part) => part.split(" : "))
    .map((part) => part.split(/\s+/).join(" ").trim())
    .filter(Boolean);

const translations: Record<string, (text: string) => string> = {
  prefix: (text) => mapText(text, (piece) => (piece.trim() ? piece.replace(/(\S)/, "Ü$1") : piece)),
  stress: (text) =>
    "- " + mapText(text, (piece, index) => (index === 0 ? `${piece} *x* \`y\` |z| a_ [1]_ \\ end_` : piece)),
  longer: (text) => mapText(text, (piece) => (piece.trim() ? `${piece} (übersetzt, deutlich länger)` : piece)),
};

describe("RstProcessorTest", function () {
  fixtures.forEach((filename) => {
    it(`should roundtrip ${filename} exactly`, function () {
      const input = readFixture(filename);

      assert.equal(processor.stringify(processor.parse(input)), input);
    });

    it(`should process ${filename} correctly`, function () {
      const document = processor.parse(readFixture(filename));
      const roundTripped = processor.parse(processor.stringify(document));

      assert.equal(JSON.stringify(roundTripped), JSON.stringify(document));
    });

    Object.entries(translations).forEach(([name, translate]) => {
      it.skipIf(!hasDocutils)(`should keep ${filename} structure after ${name} translation`, function () {
        const input = readFixture(filename);
        const document = processor.parse(input);

        document.segments.forEach((current) => {
          current.text = translate(current.text);
        });

        const output = processor.stringify(document);
        const original = doctree(input);
        const translated = doctree(output);

        assert.deepEqual(translated.signature, original.signature);

        document.segments.forEach((current) => {
          visible(current.text).forEach((piece) => assert.include(translated.text, piece));
        });
      });
    });
  });

  it("should convert inline markup to markers", function () {
    const { segments } = processor.parse(readFixture("sphinx.rst"));
    const intro = segments.find(({ text }) => text.startsWith("Welcome"))!;

    assert.include(intro.text, "Welcome to the {strong0}handbook{/strong0}.");
    assert.include(intro.text, "{literal2}pip install{/literal2}");
    assert.include(intro.text, "See {ref3}the setup guide{/ref3} or {ref4} for details");
    assert.include(intro.text, "{abbr10}FAQ (frequently asked questions){/abbr10}");
    assert.include(intro.text, "the {reference12}Sphinx{/reference12} site");
    assert.include(intro.text, "https://example.com/a_b stay as they are, and escaped *stars* are text.");
    assert.deepEqual(intro.tags?.ref3, { role: "ref", target: "setup" });
    assert.deepEqual(intro.tags?.ref4, { role: "ref", content: "setup" });
    assert.deepEqual(intro.tags?.reference11, { target: "https://www.python.org", suffix: "_" });
    assert.deepEqual(intro.tags?.substitution15, { name: "project" });
    assert.deepEqual(intro.tags?.footnote16, { label: "#note" });
  });

  it("should skip code, literal blocks and other non-translatable content", function () {
    const texts = processor.parse(readFixture("sphinx.rst")).segments.map(({ text }) => text);

    [
      "pip install handbook",
      "handbook --help",
      "Quoted text keeps",
      "doctest",
      "Not translated",
      "E = mc^2",
      "Content of an unknown directive.",
      "This is a comment",
      "intro",
      "Jane Doe",
    ].forEach((value) => assert.notInclude(texts, value));

    assert.includeMembers(texts, [
      "Install the package:",
      "Then run it",
      "Table of Contents",
      "Example caption",
      "The project logo",
      "The figure caption.",
      "Usage guide",
      "Contents",
      "The handbook gained a new chapter.",
      "The Handbook Project",
      "Custom title",
      "This note starts on the first line and continues here.",
      "A. Lincoln was a president, so this is not a list.",
      "Connect to a server.",
      "The host name to connect to, given as a string.",
      "A connection object.",
      "spanning cell",
      "Second letter, continued here",
      "Frameworks",
      "CSV data",
    ]);
  });

  it("should keep links working when their text changes", function () {
    const document = processor.parse("See Sphinx_, `the docs`_ and :term:`build`.\n");

    document.segments[0].text =
      "Siehe {reference0}Sphinx-Seite{/reference0}, {reference1}die Doku{/reference1} und {term2}Build{/term2}.";

    assert.equal(
      processor.stringify(document),
      "Siehe `Sphinx-Seite <Sphinx_>`_, `die Doku <the docs_>`_ und :term:`Build <build>`.\n",
    );
  });

  it("should resize title adornments", function () {
    const document = processor.parse("Title\n=====\n\n=========\n Heading\n=========\n\nLonger\n==========\n");

    document.segments[0].text = "Überschrift";
    document.segments[1].text = "日本語";
    document.segments[2].text = "Kurz";

    assert.equal(
      processor.stringify(document),
      "Überschrift\n===========\n\n========\n 日本語\n========\n\nKurz\n==========\n",
    );
  });

  it("should widen tables for longer translations", function () {
    const document = processor.parse("+-----+-----+\n| a   | b   |\n+-----+-----+\n\n===  ===\nx    y\n===  ===\n");

    document.segments.forEach((current) => {
      current.text = `${current.text} longer`;
    });

    assert.equal(
      processor.stringify(document),
      "+----------+----------+\n| a longer | b longer |\n+----------+----------+\n\n========  ========\nx longer  y longer\n========  ========\n",
    );
  });

  it("should escape markup characters and block starts", function () {
    const document = processor.parse("Paragraph.\n");

    document.segments[0].text = "1. Not a list with *stars* and `ticks`";

    assert.equal(processor.stringify(document), "\\1. Not a list with \\*stars\\* and \\`ticks\\`\n");
  });

  it("should separate markup from adjacent words", function () {
    const document = processor.parse("Some **bold** text.\n");

    document.segments[0].text = "Ein{strong0}fett{/strong0}er Text.";

    assert.equal(processor.stringify(document), "Ein\\ **fett**\\ er Text.\n");
  });

  it("should re-wrap translations like the original lines", function () {
    const document = processor.parse(
      "This paragraph is wrapped at a narrow\nwidth of about forty columns so that\nwe can see the effect.\n\n" +
        ":param host: The host name to\n    connect to.\n",
    );

    document.segments[0].text =
      "Dieser Absatz ist bei einer schmalen Breite von etwa vierzig Spalten umbrochen, damit man den Effekt sieht.";
    document.segments[1].text = "Der Hostname, mit dem die Verbindung hergestellt werden soll.";

    assert.equal(
      processor.stringify(document),
      "Dieser Absatz ist bei einer schmalen\nBreite von etwa vierzig Spalten\numbrochen, damit man den Effekt\nsieht.\n\n" +
        ":param host: Der Hostname,\n    mit dem die Verbindung\n    hergestellt werden soll.\n",
    );
  });

  it("should keep one sentence per line", function () {
    const document = processor.parse("First sentence here.\nSecond one follows.\nThird ends it.\n");

    document.segments[0].text = "Erster Satz hier. Zweiter folgt sofort danach. Dritter beendet ihn.";

    assert.equal(
      processor.stringify(document),
      "Erster Satz hier.\nZweiter folgt sofort danach.\nDritter beendet ihn.\n",
    );
  });

  it("should keep single-line paragraphs on one line", function () {
    const document = processor.parse("Short single line.\n");

    document.segments[0].text = "Ein deutlich längerer übersetzter Satz, der trotzdem auf einer einzigen Zeile bleiben soll.";

    assert.equal(processor.stringify(document), `${document.segments[0].text}\n`);
  });

  it("should not break escaped spaces or leave punctuation-only lines", function () {
    const document = processor.parse("A paragraph that is wrapped\nover two lines.\n");

    document.segments[0].text = "Ein{strong0}fett{/strong0}er Text und dann ---- am Ende";

    const lines = processor.stringify(document).trimEnd().split("\n");

    assert.isTrue(lines.some((line) => line.includes("Ein\\ **fett**\\ er")));
    lines.forEach((line) => assert.notMatch(line.trim(), /^-{4,}$/));
  });

  it("should keep links to translated section titles working", function () {
    const document = processor.parse("See `Project Fundamentals`_.\n\nProject Fundamentals\n--------------------\n\nText.\n");

    document.segments.find(({ text }) => text === "Project Fundamentals")!.text = "Projektgrundlagen";

    assert.include(processor.stringify(document), ".. _Project Fundamentals:\n\nProjektgrundlagen\n-----------------\n");
  });

  it("should keep names of renamed links that are reused elsewhere", function () {
    const document = processor.parse("Read `the spec <https://example.com/spec>`_.\n\nAgain: `the spec`_.\n");

    document.segments[0].text = "Lies {reference0}die Spezifikation{/reference0}.";

    assert.equal(
      processor.stringify(document),
      "Lies `die Spezifikation <https://example.com/spec>`__.\n\nAgain: `the spec`_.\n\n.. _the spec: https://example.com/spec\n",
    );
  });

  it("should keep link names with escaped angle brackets", function () {
    const document = processor.parse("Root: `\\<document>`_ element.\n");

    assert.equal(document.segments[0].text, "Root: {reference0}<document>{/reference0} element.");

    document.segments[0].text = "Wurzel: {reference0}Ü<document>{/reference0} Element.";

    assert.equal(processor.stringify(document), "Wurzel: `\\<document>`_ Element.\n");
  });

  it("should handle roles named like markup and escaped spaces before the end", function () {
    const { segments } = processor.parse("Start (:literal:`.. \\ `), then text.\n");

    assert.deepEqual(segments[0].tags, { literal0: { role: "literal", content: ".. \\ " } });
    assert.equal(segments[0].text, "Start ({literal0}), then text.");
  });

  it("should skip literal blocks after a field's first line", function () {
    const texts = processor.parse(readFixture("links.rst")).segments.map(({ text }) => text);

    assert.include(texts, "Load the standard fonts:");
    texts.forEach((text) => assert.notInclude(text, "usepackage"));
  });

  it("should honor the default role", function () {
    const { segments } = processor.parse(readFixture("links.rst"));
    const formula = segments.find(({ text }) => text.startsWith("A formula"))!;

    assert.equal(formula.text, "A formula {interpreted0} in the default role.");
    assert.deepEqual(formula.tags?.interpreted0, { role: "", content: "\\acute{x}" });
  });

  it("should translate extra prose directives on request", function () {
    const input = ".. callout::\n\n   Custom directive text.\n";

    assert.lengthOf(processor.parse(input).segments, 0);
    assert.lengthOf(processor.parse(input, { proseDirectives: ["callout"] }).segments, 1);
  });

  it("should produce deterministic ids", function () {
    const input = readFixture("sphinx.rst");

    assert.deepEqual(processor.parse(input), processor.parse(input));
  });
});
