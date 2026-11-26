/**
 * The light shape of a function: the sequence of its tokens, with each name and each literal value replaced by its
 * kind. Two functions with one shape differ only in their names, their literal values or their types (a type-2 clone).
 * The package uses only the built-in modules of Node.js and has no parser. Thus a check in each CI can use it.
 */
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";

/** The options of a read. */
export interface ShapeOptions {
  /** When true, the read removes the TypeScript types first, with `stripTypeScriptTypes` of `node:module`. */
  readonly typescript?: boolean;
}

/** A top-level function of a source: its name, the line of its name, and the shape tokens of its parameters and body. */
export interface FunctionShape {
  readonly name: string;
  readonly line: number;
  readonly tokens: readonly string[];
}

/** The token count under which a function has no shape for a match. A smaller body is too trivial to be a copy. */
export const MIN_SHAPE_TOKENS = 16;

/** A token with its line and with the flag of a line break before it. */
interface Token {
  readonly shape: string;
  /** The text of a name. The other tokens keep an empty text. */
  readonly text: string;
  readonly line: number;
  readonly newline: boolean;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "null",
  "of", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield",
]);

/** The keywords after which a slash starts a regular expression. */
const REGEX_AFTER: ReadonlySet<string> = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield",
  "await", "export", "default", "extends",
]);

/** The punctuators, the longest first, so that one scan finds the longest match. */
const PUNCTUATORS: readonly string[] = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "**", "<<", ">>",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "?", ":", "=",
  ".", "@", "#",
];

const isIdStart = (char: string): boolean => /[\p{ID_Start}$_]/u.test(char);
const isIdPart = (char: string): boolean => /[\p{ID_Continue}$‌‍]/u.test(char);

/** This function tells if a slash after the token `previous` starts a regular expression. */
function regexAllowed(previous: string | undefined): boolean {
  if (previous === undefined) return true;
  if (REGEX_AFTER.has(previous)) return true;
  // A backtick here is the end of a template literal: its start goes with its text
  if ([")", "]", "}", "`", "++", "--"].includes(previous)) return false;
  if (previous.startsWith("$") || KEYWORDS.has(previous)) return false;
  return true;
}

/** This function gives the tokens of a JavaScript source, with their lines. */
function scan(source: string): Token[] {
  const tokens: Token[] = [];
  // Each entry is "template" for a substitution of a template literal, or "brace" for a brace
  const braces: ("template" | "brace")[] = [];
  let at = 0;
  let line = 1;
  let newline = false;
  const push = (shape: string, startLine: number, text = ""): void => {
    tokens.push({ shape, text, line: startLine, newline });
    newline = false;
  };
  const advance = (to: number): void => {
    for (let index = at; index < to; index++) if (source[index] === "\n") line++;
    at = to;
  };
  /** This function reads the rest of a template literal from `at`, up to its end or to a substitution. */
  const templateRest = (): void => {
    let index = at;
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") index += 2;
      else if (char === "`") {
        advance(index + 1);
        push("`", line);
        return;
      } else if (char === "$" && source[index + 1] === "{") {
        advance(index + 2);
        push("${", line);
        braces.push("template");
        return;
      } else index++;
    }
    advance(source.length);
  };
  while (at < source.length) {
    const char = source[at] as string;
    const start = line;
    if (char === "\n") {
      advance(at + 1);
      newline = true;
      continue;
    }
    if (/\s/u.test(char)) {
      advance(at + 1);
      continue;
    }
    if (char === "/" && source[at + 1] === "/") {
      const end = source.indexOf("\n", at);
      advance(end === -1 ? source.length : end);
      continue;
    }
    if (char === "/" && source[at + 1] === "*") {
      const end = source.indexOf("*/", at + 2);
      advance(end === -1 ? source.length : end + 2);
      continue;
    }
    if (char === "'" || char === '"') {
      let index = at + 1;
      while (index < source.length && source[index] !== char && source[index] !== "\n") index += source[index] === "\\" ? 2 : 1;
      advance(Math.min(index + 1, source.length));
      push("$str", start);
      continue;
    }
    if (char === "`") {
      // A template literal: the shape keeps its backticks and its substitutions, not its text
      advance(at + 1);
      push("`", start);
      templateRest();
      continue;
    }
    if (char === "}" && braces[braces.length - 1] === "template") {
      braces.pop();
      advance(at + 1);
      push("}", start);
      templateRest();
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[at + 1] ?? ""))) {
      const match = /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:[0-9][0-9_]*)?\.?[0-9_]*(?:[eE][+-]?[0-9_]+)?)n?/.exec(source.slice(at)) as RegExpExecArray;
      const text = match[0].length > 0 ? match[0] : char;
      advance(at + text.length);
      push(text.endsWith("n") ? "$big" : "$num", start);
      continue;
    }
    if (isIdStart(char) || char === "\\") {
      let index = at + 1;
      while (index < source.length && (isIdPart(source[index] as string) || source[index] === "\\")) index++;
      const word = source.slice(at, index);
      advance(index);
      const previous = tokens[tokens.length - 1]?.shape;
      // A name after a dot is a property, also when it is a keyword: `map.delete`
      if (previous === "." || previous === "?." || previous === "#") push("$id", start, word);
      else if (word === "true" || word === "false") push("$bool", start);
      else if (KEYWORDS.has(word)) push(word, start);
      else push("$id", start, word);
      continue;
    }
    if (char === "/" && regexAllowed(tokens[tokens.length - 1]?.shape)) {
      let index = at + 1;
      let inClass = false;
      while (index < source.length && source[index] !== "\n") {
        const next = source[index];
        if (next === "\\") index++;
        else if (next === "[") inClass = true;
        else if (next === "]") inClass = false;
        else if (next === "/" && !inClass) break;
        index++;
      }
      index++;
      while (index < source.length && isIdPart(source[index] as string)) index++;
      advance(Math.min(index, source.length));
      push("$re", start);
      continue;
    }
    const punctuator = PUNCTUATORS.find((candidate) => source.startsWith(candidate, at)) ?? char;
    if (punctuator === "{" || punctuator === "${") braces.push("brace");
    else if (punctuator === "}") braces.pop();
    advance(at + punctuator.length);
    push(punctuator, start);
  }
  return tokens;
}

/** This function gives the source as JavaScript: with `typescript`, it removes the types and keeps each line. */
function javascriptOf(source: string, options: ShapeOptions | undefined): string {
  return options?.typescript === true ? stripTypeScriptTypes(source, { mode: "strip" }) : source;
}

/**
 * This function gives the shape tokens of a source. A name becomes `$id`, a string `$str`, a number `$num`, a big
 * integer `$big`, a regular expression `$re` and a boolean `$bool`. A template literal keeps its backticks and its
 * substitutions. The keywords, the punctuators and the operators stay. Comments and white space go.
 */
export function shapeTokens(source: string, options?: ShapeOptions): string[] {
  return scan(javascriptOf(source, options)).map((token) => token.shape);
}

/** This function gives the SHA-256 hash, in hex, of the tokens joined by a space. */
export function shapeHash(tokens: readonly string[]): string {
  return createHash("sha256").update(tokens.join(" ")).digest("hex");
}

/**
 * This function tells if `needle` is a contiguous run of `haystack`. A needle with fewer than `MIN_SHAPE_TOKENS` tokens
 * gives false, because a short run is in most code. Thus a body that inlines the body of a home function is found.
 */
export function containsShape(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length < MIN_SHAPE_TOKENS) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let index = 0;
    while (index < needle.length && haystack[start + index] === needle[index]) index++;
    if (index === needle.length) return true;
  }
  return false;
}

const OPEN: ReadonlySet<string> = new Set(["(", "[", "{", "${"]);
const CLOSE: ReadonlySet<string> = new Set([")", "]", "}"]);

/** The tokens after which a line break does not end an expression. */
const CONTINUES_AFTER: ReadonlySet<string> = new Set([
  "=>", "?", ":", ",", ".", "?.", "=", "+", "-", "*", "/", "%", "**", "&&", "||", "??", "&", "|", "^", "<", ">", "<=",
  ">=", "==", "!=", "===", "!==", "<<", ">>", ">>>", "!", "~", "typeof", "void", "delete", "await", "new", "in",
  "instanceof", "return",
]);

/** The tokens before which a line break does not end an expression. */
const CONTINUES_BEFORE: ReadonlySet<string> = new Set([
  "?", ":", ".", "?.", "+", "*", "/", "%", "**", "&&", "||", "??", "&", "|", "^", "<", ">", "<=", ">=", "==", "!=",
  "===", "!==", "<<", ">>", ">>>", "in", "instanceof", ")", "]", "}",
]);

/** This function gives the index after the group that opens at `start`. */
function groupEnd(tokens: readonly Token[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const shape = (tokens[index] as Token).shape;
    if (OPEN.has(shape)) depth++;
    else if (CLOSE.has(shape)) {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return tokens.length;
}

/**
 * This function gives the index after the expression that starts at `start`. The expression ends at a `,` or a `;` at
 * its depth, or at a close of an outer group. It also ends at a line break that cannot continue it.
 */
function expressionEnd(tokens: readonly Token[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index] as Token;
    if (depth === 0 && index > start) {
      if (token.shape === "," || token.shape === ";" || CLOSE.has(token.shape)) return index;
      const previous = (tokens[index - 1] as Token).shape;
      if (token.newline && !CONTINUES_AFTER.has(previous) && !CONTINUES_BEFORE.has(token.shape)) return index;
    }
    if (OPEN.has(token.shape)) depth++;
    else if (CLOSE.has(token.shape)) {
      if (depth === 0) return index;
      depth--;
    }
  }
  return tokens.length;
}

/** The tokens after which a group in parentheses is a call, a condition or a list of parameters, not an expression. */
const NOT_GROUPING_AFTER: ReadonlySet<string> = new Set([
  "$id", ")", "]", "`", "if", "while", "for", "switch", "catch", "with", "function", "super", "import", "?.",
]);

/**
 * This function removes the differences of style from the tokens of a function: each `;` and each trailing comma.
 * It also removes the parentheses around one token, as `(value)`, that hold no call and no condition.
 */
function normalize(tokens: readonly string[]): string[] {
  const out: string[] = [];
  // The first parenthesis opens the parameters, which keep their parentheses
  const params = tokens.indexOf("(");
  for (let index = 0; index < tokens.length; index++) {
    const shape = tokens[index] as string;
    if (shape === ";") continue;
    if (shape === "," && CLOSE.has(tokens[index + 1] ?? "")) continue;
    if (shape === "(" && index !== params && tokens[index + 2] === ")" && tokens[index + 3] !== "=>") {
      const inner = tokens[index + 1] as string;
      const before = out[out.length - 1];
      if (inner.startsWith("$") && before !== undefined && !NOT_GROUPING_AFTER.has(before) && !before.startsWith("$")) {
        out.push(inner);
        index += 2;
        continue;
      }
    }
    out.push(shape);
  }
  return out;
}

/**
 * This function reads a function or an arrow function at `start`. It gives the shape tokens of the parameters and the
 * body, and the index after the function, or undefined when no function starts there. An arrow function with an
 * expression body gets the tokens of a block with one `return`, so that `(v) => v * 2` and
 * `function (v) { return v * 2; }` have one shape.
 */
function functionAt(tokens: readonly Token[], start: number): { readonly shape: string[]; readonly end: number } | undefined {
  let index = start;
  const prefix: string[] = [];
  if (tokens[index]?.shape === "async" && !(tokens[index + 1]?.newline ?? true)) {
    prefix.push("async");
    index++;
  }
  const head = tokens[index]?.shape;
  if (head === "function") {
    index++;
    if (tokens[index]?.shape === "*") {
      prefix.push("*");
      index++;
    }
    if (tokens[index]?.shape === "$id") index++;
    if (tokens[index]?.shape !== "(") return undefined;
    const paramsEnd = groupEnd(tokens, index);
    if (tokens[paramsEnd]?.shape !== "{") return undefined;
    const end = groupEnd(tokens, paramsEnd);
    return { shape: [...prefix, ...tokens.slice(index, end).map((token) => token.shape)], end };
  }
  let params: string[];
  let arrow: number;
  if (head === "$id" && tokens[index + 1]?.shape === "=>") {
    params = ["(", "$id", ")"];
    arrow = index + 1;
  } else if (head === "(") {
    arrow = groupEnd(tokens, index);
    if (tokens[arrow]?.shape !== "=>") return undefined;
    params = tokens.slice(index, arrow).map((token) => token.shape);
  } else return undefined;
  const bodyStart = arrow + 1;
  if (tokens[bodyStart]?.shape === "{") {
    const end = groupEnd(tokens, bodyStart);
    return { shape: [...prefix, ...params, ...tokens.slice(bodyStart, end).map((token) => token.shape)], end };
  }
  const end = expressionEnd(tokens, bodyStart);
  const body = tokens.slice(bodyStart, end).map((token) => token.shape);
  return { shape: [...prefix, ...params, "{", "return", ...body, "}"], end };
}

/**
 * This function gives each top-level function of a source. These are the function declarations, and each `const`,
 * `let` or `var` of a function expression or an arrow function. An `export` before it does not change the result. The tokens are
 * those of the parameters and the body, not the name. They have no differences of style (`normalize`).
 */
export function functionsOf(source: string, options?: ShapeOptions): FunctionShape[] {
  const javascript = javascriptOf(source, options);
  const tokens = scan(javascript);
  const found: FunctionShape[] = [];
  let depth = 0;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as Token;
    if (depth === 0) {
      if (token.shape === "function" || (token.shape === "async" && tokens[index + 1]?.shape === "function")) {
        const nameIndex = token.shape === "async" ? index + 2 : index + 1;
        const named = tokens[nameIndex]?.shape === "*" ? nameIndex + 1 : nameIndex;
        const read = functionAt(tokens, index);
        if (read !== undefined) {
          const nameToken = tokens[named] as Token;
          const isNamed = nameToken.shape === "$id";
          const before = tokens[index - 1]?.shape;
          found.push({
            name: isNamed ? nameToken.text : before === "default" ? "default" : "",
            line: isNamed ? nameToken.line : token.line,
            tokens: normalize(read.shape),
          });
          index = read.end;
          continue;
        }
      }
      if ((token.shape === "const" || token.shape === "let" || token.shape === "var") && tokens[index + 1]?.shape === "$id") {
        index = declarators(tokens, index + 1, found);
        continue;
      }
    }
    if (OPEN.has(token.shape)) depth++;
    else if (CLOSE.has(token.shape)) depth = Math.max(0, depth - 1);
    index++;
  }
  return found.filter((entry) => entry.name !== "");
}

/** This function reads the declarators of a `const`, `let` or `var` from `start`, and gives the index after them. */
function declarators(tokens: readonly Token[], start: number, found: FunctionShape[]): number {
  let index = start;
  while (tokens[index]?.shape === "$id" && tokens[index + 1]?.shape === "=") {
    const nameToken = tokens[index] as Token;
    const read = functionAt(tokens, index + 2);
    if (read !== undefined && (read.end >= tokens.length || [",", ";"].includes((tokens[read.end] as Token).shape) || (tokens[read.end] as Token).newline)) {
      found.push({ name: nameToken.text, line: nameToken.line, tokens: normalize(read.shape) });
      index = read.end;
    } else index = expressionEnd(tokens, index + 2);
    if (tokens[index]?.shape !== ",") return index;
    index++;
  }
  return index;
}
