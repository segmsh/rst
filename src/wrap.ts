import { displayWidth } from "./inline.js";

export interface WrapStyle {
  // Widest original line, in display columns
  width: number;
  // Column where the text starts on the first line
  column: number;
  // Indentation of the following lines
  indent: number;
  // One sentence per line instead of filling up to the width
  sentences: boolean;
}

// Plain spaces only; an escaped space ("\ ") must stay on its line
const BREAK_REGEXP: RegExp = /(?<!\\) +/;
const SENTENCE_END_REGEXP: RegExp = /[.!?:;]["')\]”’]*$/;
// A line of repeated punctuation would turn the previous line into a title
const ADORNMENT_REGEXP: RegExp = /^([!-/:-@[-`{-~])\1{3,}$/;

// Detects how the original lines of a paragraph were broken
export const detectWrapStyle = (lines: string[], column: number, indent: number): WrapStyle | null => {
  if (lines.length < 2) return null;

  const trimmed = lines.map((line) => line.trimEnd());

  return {
    width: Math.max(...trimmed.map(displayWidth)),
    column,
    indent,
    sentences: lines.length > 2 && trimmed.slice(0, -1).every((line) => SENTENCE_END_REGEXP.test(line)),
  };
};

export const wrap = (text: string, style: WrapStyle): string[] => {
  const words = text.split(BREAK_REGEXP).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const available = (lines.length ? style.width - style.indent : style.width - style.column);
    const candidate = current ? `${current} ${word}` : word;
    const full = style.sentences
      ? SENTENCE_END_REGEXP.test(current)
      : displayWidth(candidate) > available;

    if (current && full) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });

  if (current) lines.push(current);

  // Never leave a punctuation-only line: join it with the previous one
  return lines.reduce<string[]>((result, line) => {
    if (result.length && ADORNMENT_REGEXP.test(line)) {
      result[result.length - 1] += ` ${line}`;
    } else {
      result.push(line);
    }
    return result;
  }, []);
};
