import { describe, expect, it } from "vitest";
import { containsShape, functionsOf, MIN_SHAPE_TOKENS, shapeHash, shapeTokens, TYPESCRIPT_READ } from "./index.ts";

/** This function gives the shape hash of the one top-level function of a source. */
function hashOf(source: string, typescript = false): string {
  const found = functionsOf(source, { typescript });
  expect(found).toHaveLength(1);
  return shapeHash((found[0] as { readonly tokens: readonly string[] }).tokens);
}

describe("shapeTokens", () => {
  it("replaces names and literals by their kinds and keeps keywords and operators", () => {
    expect(shapeTokens(`const total = price * 2 + "x" + 10n;`)).toEqual(["const", "$id", "=", "$id", "*", "$num", "+", "$str", "+", "$big", ";"]);
  });

  it("drops comments and white space", () => {
    expect(shapeTokens("a /* one */ + // two\n b")).toEqual(["$id", "+", "$id"]);
  });

  it("tells a regular expression from a division by the token before the slash", () => {
    expect(shapeTokens("x = a / b / c")).toEqual(["$id", "=", "$id", "/", "$id", "/", "$id"]);
    expect(shapeTokens("x = /a\\/b[/]/g.test(s)")).toEqual(["$id", "=", "$re", ".", "$id", "(", "$id", ")"]);
    expect(shapeTokens("return /x/")).toEqual(["return", "$re"]);
    expect(shapeTokens("f(a) / 2")).toEqual(["$id", "(", "$id", ")", "/", "$num"]);
  });

  it("keeps the substitutions of a template literal, also with braces inside them", () => {
    expect(shapeTokens("`a${ { k: 1 }.k }b${x}c`")).toEqual(["`", "${", "{", "$id", ":", "$num", "}", ".", "$id", "}", "${", "$id", "}", "`"]);
    expect(shapeTokens("`plain ${'}'} text`")).toEqual(["`", "${", "$str", "}", "`"]);
  });

  it("reads a keyword after a dot as a name", () => {
    expect(shapeTokens("map.delete(key)")).toEqual(["$id", ".", "$id", "(", "$id", ")"]);
  });

  it("gives one kind to the two booleans", () => {
    expect(shapeTokens("true")).toEqual(shapeTokens("false"));
  });

  it("removes TypeScript types with the option typescript", () => {
    expect(shapeTokens("const n: number = f<string>(x as unknown);", { typescript: true })).toEqual(shapeTokens("const n = f(x);"));
  });
});

describe("shapeHash", () => {
  it("gives the SHA-256 hex of the tokens joined by a space", () => {
    expect(shapeHash(["a", "b"])).toBe("c8687a08aa5d6ed2044328fa6a697ab8e96dc34291e8c2034ae8c38e6fcc6d65");
    expect(shapeHash(["a", "b"])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("functionsOf", () => {
  const source = [
    "import { x } from 'y';", // 1
    "", // 2
    "export function first(a, b) {", // 3
    "  function inner() { return 1; }", // 4
    "  return a + b;", // 5
    "}", // 6
    "const second = async (v) => {", // 7
    "  await v;", // 8
    "};", // 9
    "export const third = function* (n) { yield n; }, fourth = (m) => m * 2;", // 10
    "let fifth = n => n", // 11
    "var value = 5;", // 12
    "export default function () {}", // 13
    "if (x) { const hidden = () => 1; }", // 14
  ].join("\n");

  it("finds each top-level function with its name and the line of its name", () => {
    expect(functionsOf(source).map(({ name, line }) => [name, line])).toEqual([
      ["first", 3],
      ["second", 7],
      ["third", 10],
      ["fourth", 10],
      ["fifth", 11],
      ["default", 13],
    ]);
  });

  it("gives the tokens of the parameters and the body only, not the name", () => {
    const [first] = functionsOf(source);
    expect(first?.tokens).toEqual(["(", "$id", ",", "$id", ")", "{", "function", "$id", "(", ")", "{", "return", "$num", "}", "return", "$id", "+", "$id", "}"]);
  });

  it("marks an async function and a generator", () => {
    const found = functionsOf(source);
    expect(found[1]?.tokens[0]).toBe("async");
    expect(found[2]?.tokens[0]).toBe("*");
  });

  it("ends an arrow body with no semicolon at the end of its line", () => {
    const found = functionsOf("const a = (v) => v\nconst b = (w) =>\n  w\n    ? 1\n    : 2\nconst c = 3");
    expect(found.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(found[1]?.tokens).toEqual(["(", "$id", ")", "{", "return", "$id", "?", "$num", ":", "$num", "}"]);
  });

  it("gives one shape to an arrow with an expression body and a function with one return", () => {
    expect(hashOf("const twice = (v) => v * 2;")).toBe(hashOf("function double(n) { return n * 2; }"));
    expect(hashOf("const twice = v => v * 2")).toBe(hashOf("function double(n) { return n * 2 }"));
  });
});

describe("one shape for copies", () => {
  const isRecord = `export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}`;

  it("gives one hash to two copies with other names and other literals", () => {
    const other = `function isPlainBag(input) {
  // a copy with other names and a literal of the same kind
  return typeof input === 'function' && input !== null && !List.isList(input);
}`;
    expect(hashOf(other)).toBe(hashOf(isRecord));
  });

  it("gives one hash to a TypeScript copy and its JavaScript", () => {
    const typescript = `export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;`;
    const javascript = `export const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;`;
    expect(hashOf(typescript, true)).toBe(hashOf(javascript));
  });

  it("gives a different hash for a changed operator", () => {
    expect(hashOf(isRecord.replace("value !== null", "value === null"))).not.toBe(hashOf(isRecord));
    expect(hashOf(isRecord.replace(" && !Array", " || !Array"))).not.toBe(hashOf(isRecord));
  });

  it("gives no shape for a match to a trivial body", () => {
    for (const trivial of ["const id = (v) => v;", "function pass(v) { return v; }", "const read = (v) => f(v) ? v : undefined;"]) {
      const [found] = functionsOf(trivial);
      expect(found?.tokens.length).toBeLessThan(MIN_SHAPE_TOKENS);
    }
    expect(functionsOf(isRecord)[0]?.tokens.length).toBeGreaterThanOrEqual(MIN_SHAPE_TOKENS);
  });
});

/*
 * A real pair of this week. The first function is `recordOf` of `packages/stack-hazards/src/exposure.ts` in
 * mark1russell7/system-stack (MIT). The others are the build output of the entry `/read` of
 * `@mark1russell7/optional@1.5.0` (`dist/read.js`, MIT).
 */
describe("the recordOf pair", () => {
  const stackHazards = `/** This function gives the value as a record, or \`undefined\`. */
const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;`;
  const optional = `export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function fieldOf(value, key) {
    return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}
export function readRecord(value) {
    return isRecord(value) ? value : undefined;
}
export function recordOf(value, key) {
    return readRecord(fieldOf(value, key));
}`;

  it("gives two hashes: the two functions named recordOf do different work", () => {
    const local = functionsOf(stackHazards, { typescript: true });
    const home = functionsOf(optional);
    expect(local.map((entry) => entry.name)).toEqual(["recordOf"]);
    expect(home.map((entry) => entry.name)).toEqual(["isRecord", "fieldOf", "readRecord", "recordOf"]);
    const localHash = shapeHash(local[0]?.tokens ?? []);
    // The local recordOf is readRecord with isRecord inlined. The recordOf of the home reads a field first.
    for (const entry of home) expect(shapeHash(entry.tokens)).not.toBe(localHash);
  });

  it("holds the body of isRecord of the home as a contiguous run (containsShape)", () => {
    const local = functionsOf(stackHazards, { typescript: true })[0]?.tokens ?? [];
    const isRecord = functionsOf(optional)[0]?.tokens ?? [];
    // The run is the condition: the tokens between `return` and the close of the body
    const body = isRecord.slice(isRecord.indexOf("return") + 1, -1);
    expect(body).toHaveLength(MIN_SHAPE_TOKENS);
    expect(containsShape(local, body)).toBe(true);
    // The whole function is not a run: the local copy continues the condition with `? value : undefined`
    expect(containsShape(local, isRecord)).toBe(false);
  });
});

describe("containsShape", () => {
  const long = Array.from({ length: MIN_SHAPE_TOKENS }, (_, index) => (index % 2 === 0 ? "$id" : "+"));

  it("finds a contiguous run at the start, in the middle and at the end", () => {
    expect(containsShape(long, long)).toBe(true);
    expect(containsShape(["{", ...long, "}"], long)).toBe(true);
    expect(containsShape(["return", ...long], long)).toBe(true);
  });

  it("gives false for a run with a gap or a changed token", () => {
    const gap = [...long.slice(0, 4), "(", ...long.slice(4)];
    expect(containsShape(gap, long)).toBe(false);
    expect(containsShape(long, [...long.slice(0, -1), "-"])).toBe(false);
  });

  it("gives false for a needle under the floor", () => {
    expect(containsShape(long, long.slice(1))).toBe(false);
    expect(containsShape(long, [])).toBe(false);
  });
});

describe("TYPESCRIPT_READ", () => {
  it("is true from Node.js 22.13, the first version with stripTypeScriptTypes", () => {
    const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
    expect(TYPESCRIPT_READ).toBe(major > 22 || (major === 22 && minor >= 13));
  });
});
