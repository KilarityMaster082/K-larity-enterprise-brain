// Owner task: EB-102 File viewers — the spreadsheet viewer's formula evaluator (screen 30). A small recursive-descent parser
// (never eval) for + - * / ( ), cell references (A1, row 1 is the header row) and SUM / AVERAGE / MIN / MAX / COUNT over ranges.
// Pure, unit-tested in tests/viewers.test.ts. Errors are spreadsheet-style strings, never exceptions.
import type { SheetCell } from "../data/types";

export type Evaluated = number | string;
export const ERR = { div0: "#DIV/0!", ref: "#REF!", cycle: "#CYCLE!", name: "#NAME?", parse: "#ERROR!" } as const;

class SheetError extends Error {}

/** "C" -> 2, "AA" -> 26. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

interface Tok { t: "num" | "ref" | "id" | "op" | "colon" | "comma"; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z]{1,3}\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/()])|(:)|(,))/gy;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new SheetError(ERR.parse);
    }
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "ref", v: m[2] });
    else if (m[3] !== undefined) out.push({ t: "id", v: m[3] });
    else if (m[4] !== undefined) out.push({ t: "op", v: m[4] });
    else if (m[5] !== undefined) out.push({ t: "colon", v: ":" });
    else out.push({ t: "comma", v: "," });
  }
  return out;
}

/** Evaluate every cell of one sheet. `rows` excludes the header row, so A2 is rows[0][0]. */
export function evaluateSheet(rows: SheetCell[][]): Evaluated[][] {
  const cache = new Map<string, Evaluated>();
  const active = new Set<string>();

  function read(c: number, r: number): Evaluated {
    if (r < 2 || c < 0) throw new SheetError(ERR.ref);
    const cell = rows[r - 2]?.[c];
    if (cell === undefined) return 0;
    const key = `${c},${r}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (active.has(key)) throw new SheetError(ERR.cycle);
    active.add(key);
    try {
      const v = typeof cell === "object" ? evalFormula(cell.f) : cell;
      cache.set(key, v);
      return v;
    } catch (e) {
      const v = e instanceof SheetError ? e.message : ERR.parse;
      cache.set(key, v);
      return v;
    } finally {
      active.delete(key);
    }
  }

  function num(v: Evaluated): number {
    if (typeof v === "number") return v;
    if (v === "") return 0;
    if (v.startsWith("#")) throw new SheetError(v); // errors propagate
    const n = Number(v);
    if (Number.isNaN(n)) throw new SheetError(ERR.parse);
    return n;
  }

  function evalFormula(f: string): Evaluated {
    const toks = tokenize(f.replace(/^=/, ""));
    let i = 0;
    const peek = () => toks[i];
    const eat = () => toks[i++];

    const cellOf = (ref: string): [number, number] => {
      const m = /^([A-Za-z]+)(\d+)$/.exec(ref)!;
      return [colIndex(m[1]!), Number(m[2])];
    };

    function range(a: string, b: string): number[] {
      const [c1, r1] = cellOf(a);
      const [c2, r2] = cellOf(b);
      const vals: number[] = [];
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          const v = read(c, r);
          if (typeof v === "string" && v.startsWith("#")) throw new SheetError(v);
          if (typeof v === "number") vals.push(v); // text in a range is ignored, like a spreadsheet
        }
      }
      return vals;
    }

    function args(): number[] {
      const out: number[] = [];
      if (peek()?.v === ")") return out;
      for (;;) {
        const t = peek();
        if (t?.t === "ref" && toks[i + 1]?.t === "colon") {
          eat();
          eat();
          const b = eat();
          if (b?.t !== "ref") throw new SheetError(ERR.parse);
          out.push(...range(t.v, b.v));
        } else out.push(expr());
        if (peek()?.t === "comma") eat();
        else return out;
      }
    }

    function primary(): number {
      const t = eat();
      if (!t) throw new SheetError(ERR.parse);
      if (t.t === "num") return Number(t.v);
      if (t.t === "ref") {
        const [c, r] = cellOf(t.v);
        return num(read(c, r));
      }
      if (t.t === "op" && t.v === "(") {
        const v = expr();
        if (eat()?.v !== ")") throw new SheetError(ERR.parse);
        return v;
      }
      if (t.t === "op" && t.v === "-") return -primary();
      if (t.t === "op" && t.v === "+") return primary();
      if (t.t === "id") {
        if (eat()?.v !== "(") throw new SheetError(ERR.parse);
        const xs = args();
        if (eat()?.v !== ")") throw new SheetError(ERR.parse);
        switch (t.v.toUpperCase()) {
          case "SUM": return xs.reduce((a, b) => a + b, 0);
          case "AVERAGE": if (!xs.length) throw new SheetError(ERR.div0); return xs.reduce((a, b) => a + b, 0) / xs.length;
          case "MIN": return xs.length ? Math.min(...xs) : 0;
          case "MAX": return xs.length ? Math.max(...xs) : 0;
          case "COUNT": return xs.length;
          default: throw new SheetError(ERR.name);
        }
      }
      throw new SheetError(ERR.parse);
    }

    function term(): number {
      let v = primary();
      for (let t = peek(); t?.t === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
        eat();
        const r = primary();
        if (t.v === "/" && r === 0) throw new SheetError(ERR.div0);
        v = t.v === "*" ? v * r : v / r;
      }
      return v;
    }

    function expr(): number {
      let v = term();
      for (let t = peek(); t?.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
        eat();
        const r = term();
        v = t.v === "+" ? v + r : v - r;
      }
      return v;
    }

    const v = expr();
    if (i < toks.length) throw new SheetError(ERR.parse);
    return Math.round(v * 1e9) / 1e9; // tidy floating-point noise (0.1 + 0.2)
  }

  return rows.map((row, ri) => row.map((_, ci) => read(ci, ri + 2)));
}

export function isError(v: Evaluated): boolean {
  return typeof v === "string" && v.startsWith("#");
}
