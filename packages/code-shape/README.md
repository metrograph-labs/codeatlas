# @mark1russell7/code-shape

The light shape of a function. Two functions with one shape differ only in their names, their literal values or their types. Such a pair is a type-2 clone.

The package has no runtime dependencies. It uses only the built-in modules of Node.js and has no parser. Thus a check that runs in the CI of each repository can use it. The full shape of the atlas (`packages/atlas/src/shape.ts`) reads the syntax tree of `swc`, which is a native package.

## Use

```ts
import { functionsOf, MIN_SHAPE_TOKENS, shapeHash } from "@mark1russell7/code-shape";

for (const { name, line, tokens } of functionsOf(source, { typescript: true })) {
  if (tokens.length >= MIN_SHAPE_TOKENS) console.log(name, line, shapeHash(tokens));
}
```

| Export | What it does |
| --- | --- |
| `shapeTokens(source, options)` | It gives the shape tokens of a source. |
| `functionsOf(source, options)` | It gives each top-level function of a source: its name, its line and the tokens of its parameters and body. |
| `shapeHash(tokens)` | It gives the SHA-256 hash, in hex, of the tokens joined by a space. |
| `containsShape(haystack, needle)` | It tells if the needle is a contiguous run of the haystack. A needle under `MIN_SHAPE_TOKENS` gives false. |
| `MIN_SHAPE_TOKENS` | It is the token count under which a function has no shape for a match. Its value is 16. |

## The tokens

- A name becomes `$id`. A name after `.`, `?.` or `#` is also `$id`, also when it is a keyword.
- A string becomes `$str`, a number `$num`, a big integer `$big`, a regular expression `$re`, and `true` or `false` becomes `$bool`.
- A template literal keeps its backticks and its substitutions (`${` and `}`). Its text goes.
- The keywords, `null`, the punctuators and the operators stay.
- Comments and white space go.
- With `typescript: true`, `stripTypeScriptTypes` of `node:module` first removes the types. The lines stay the same.
- `stripTypeScriptTypes` is in Node.js 22.13 and later. On an older Node.js 22, the package loads and reads JavaScript, and `TYPESCRIPT_READ` is false. Then a read with `typescript` throws an error that names the Node.js version.

A slash starts a regular expression after an operator or a punctuator other than `)`, `]` and `}`. It also starts one after a keyword, for example `return`, and at the start of the source. Else it is a division.

## The functions

`functionsOf` finds these top-level functions, with or without `export`:

- A function declaration, also `async`, a generator or `export default function`.
- A `const`, `let` or `var` of a function expression or an arrow function. Each declarator of a list counts.

The tokens of a function are the tokens of its parameters and its body. `async` and the `*` of a generator come first. Then the tokens lose the differences of style:

- An arrow function with an expression body gets the tokens of a block with one `return`. Thus `(v) => v * 2` and `function (v) { return v * 2; }` have one shape.
- A single parameter with no parentheses gets parentheses.
- Each `;` and each trailing comma goes.
- Parentheses around one token go when they hold no call and no condition. Thus `(value as Fields)` after the removal of the types equals `value`.

## Limits

The tokenizer is not a parser. It does not handle these cases:

- A regular expression after `)` or `}` is read as a division. An example is `if (ok) /x/.test(s)`.
- A keyword as a key of an object, as `{ default: 1 }`, stays a keyword.
- JSX is not read as JSX. Its text gives names and punctuators.
- A TypeScript source with syntax that has a run-time effect, as `enum` or `namespace`, makes `stripTypeScriptTypes` throw.
- In Node.js 24, `stripTypeScriptTypes` is experimental and gives a warning.
- The end of an arrow function with an expression body and no `;` comes from a rule of line breaks. A line that starts with `(`, `[` or a template continues no expression.
- Methods of classes and of objects, and functions inside other functions, are not top-level functions.
- A renamed copy that also has other statements, or an inlined call, has a different hash. `containsShape` finds a body inside a bigger body. Other type-3 clones need a different measure.

## License

MIT
