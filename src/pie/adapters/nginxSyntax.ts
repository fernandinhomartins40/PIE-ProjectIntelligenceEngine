export interface NginxDirective {
  words: string[];
  line: number;
  block: boolean;
  ancestors: Array<{ words: string[]; line: number }>;
}
const escapedValue = (ch: string) =>
  ({ n: "\n", r: "\r", t: "\t", '"': '"', "'": "'", "\\": "\\" })[ch] ??
  `\\${ch}`;

/** Iterative lexer: configuration values are data, never shell or include instructions. */
export function* nginxDirectives(source: string): Generator<NginxDirective> {
  let line = 1;
  let startLine = 1;
  let word = "";
  let active = false;
  let quote = "";
  let escaped = false;
  let comment = false;
  let variable = false;
  let needSpace = false;
  let words: string[] = [];
  const ancestors: NginxDirective["ancestors"] = [];
  const flush = () => {
    if (active) words.push(word);
    word = "";
    active = false;
    needSpace = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (needSpace && !/[ \t\r\n;{]/.test(ch))
      throw new Error("Nginx expected separator after quote");
    if (comment) {
      if (ch === "\n") {
        comment = false;
        line++;
      }
      continue;
    }
    if (escaped) {
      word += escapedValue(ch);
      escaped = false;
      if (ch === "\n") line++;
      continue;
    }
    if (ch === "\\") {
      if (!active && words.length === 0) startLine = line;
      active = true;
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = "";
        needSpace = true;
      } else word += ch;
      if (ch === "\n") line++;
      continue;
    }
    if (variable) {
      word += ch;
      if (ch === "}") variable = false;
      if (ch === "\n") line++;
      continue;
    }
    if (ch === "#" && !active) {
      flush();
      comment = true;
      continue;
    }
    if (/[ \t\r\n]/.test(ch)) {
      flush();
      if (ch === "\n") line++;
      continue;
    }
    if (!active && (ch === '"' || ch === "'")) {
      if (!active && words.length === 0) startLine = line;
      quote = ch;
      active = true;
      continue;
    }
    if (ch === "{" && word.endsWith("$")) {
      word += ch;
      variable = true;
      continue;
    }
    if (ch === ";" || ch === "{" || ch === "}") {
      flush();
      if (ch === "}") {
        if (words.length || !ancestors.length)
          throw new Error("Nginx unmatched closing block");
        ancestors.pop();
        continue;
      }
      if (!words.length) throw new Error("Nginx directive missing name");
      yield {
        words,
        line: startLine,
        block: ch === "{",
        ancestors: [...ancestors],
      };
      if (ch === "{") {
        if (ancestors.length >= 128)
          throw new Error("Nginx nesting exceeds 128");
        ancestors.push({ words, line: startLine });
      }
      words = [];
      continue;
    }
    if (!active && words.length === 0) startLine = line;
    active = true;
    word += ch;
  }
  flush();
  if (quote || escaped || variable || words.length || ancestors.length)
    throw new Error("Nginx incomplete syntax");
}
