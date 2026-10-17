export interface NginxDirective {
  words: string[];
  line: number;
  block: boolean;
  ancestors: Array<{ words: string[]; line: number }>;
}
const escapedValue = (ch: string) =>
  ({ n: "\n", r: "\r", t: "\t", '"': '"', "'": "'", "\\": "\\" })[ch] ??
  `\\${ch}`;
const whitespace = (ch: string) => /[ \t\r\n]/.test(ch);
const quoteSeparator = (ch: string) =>
  whitespace(ch) || [";", "{", ")"].includes(ch);

/** One owner for token boundaries, source positions and context. */
class NginxLexer {
  line = 1;
  startLine = 1;
  word = "";
  active = false;
  quote = "";
  escaped = false;
  comment = false;
  variable = false;
  needSpace = false;
  words: string[] = [];
  readonly ancestors: NginxDirective["ancestors"] = [];
  flush() {
    if (this.active) this.words.push(this.word);
    this.word = "";
    this.active = false;
    this.needSpace = false;
  }
  begin() {
    if (!this.active && this.words.length === 0) this.startLine = this.line;
    this.active = true;
  }
  delimiter(ch: string): NginxDirective | undefined {
    this.flush();
    if (ch === "}") {
      if (this.words.length || !this.ancestors.length)
        throw new Error("Nginx unmatched closing block");
      this.ancestors.pop();
      return;
    }
    if (!this.words.length) throw new Error("Nginx directive missing name");
    const directive = {
      words: this.words,
      line: this.startLine,
      block: ch === "{",
      ancestors: [...this.ancestors],
    };
    if (directive.block) {
      if (this.ancestors.length >= 128)
        throw new Error("Nginx nesting exceeds 128");
      this.ancestors.push({ words: this.words, line: this.startLine });
    }
    this.words = [];
    return directive;
  }
  quoted(ch: string) {
    if (ch === this.quote) {
      this.quote = "";
      this.needSpace = true;
    } else this.word += ch;
  }
  consumeData(ch: string): boolean {
    if (this.comment) {
      if (ch === "\n") this.comment = false;
      return true;
    }
    if (this.escaped) {
      this.word += escapedValue(ch);
      this.escaped = false;
      return true;
    }
    if (ch === "\\") {
      this.begin();
      this.escaped = true;
      return true;
    }
    if (this.quote) {
      this.quoted(ch);
      return true;
    }
    if (this.variable) {
      this.word += ch;
      if (ch === "}") this.variable = false;
      return true;
    }
    return false;
  }
  consume(ch: string): NginxDirective | undefined {
    if (this.needSpace && !quoteSeparator(ch))
      throw new Error("Nginx expected separator after quote");
    const data = this.consumeData(ch);
    if (ch === "\n") this.line++;
    if (data) return;
    if (this.needSpace && ch === ")") {
      this.flush();
      this.begin();
      this.word = ch;
      return;
    }
    if (ch === "#" && !this.active) {
      this.comment = true;
      return;
    }
    if (whitespace(ch)) {
      this.flush();
      return;
    }
    if (!this.active && (ch === '"' || ch === "'")) {
      this.begin();
      this.quote = ch;
      return;
    }
    if (ch === "{" && this.word.endsWith("$")) {
      this.word += ch;
      this.variable = true;
      return;
    }
    // Closing braces delimit blocks only at token boundaries; URL/regex braces are data.
    if (ch === ";" || ch === "{" || (ch === "}" && !this.active))
      return this.delimiter(ch);
    this.begin();
    this.word += ch;
    return undefined;
  }
  finish() {
    this.flush();
    if (
      this.quote ||
      this.escaped ||
      this.variable ||
      this.words.length ||
      this.ancestors.length
    )
      throw new Error("Nginx incomplete syntax");
  }
}

/** Iterative lexer: values are data, never shell or include instructions. */
export function* nginxDirectives(source: string): Generator<NginxDirective> {
  const lexer = new NginxLexer();
  for (const ch of source) {
    const directive = lexer.consume(ch);
    if (directive) yield directive;
  }
  lexer.finish();
}
