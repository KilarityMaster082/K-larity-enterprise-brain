// Owner task: EB-102 File viewers — line diff for the code viewer (screen 37). Classic LCS over lines; files here are small
// config/script files, so O(n·m) is fine. Pure, unit-tested in tests/viewers.test.ts.
export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
  /** 1-based line numbers in the old / new file (undefined on the side where the line does not exist). */
  oldNo?: number;
  newNo?: number;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ kind: "same", text: a[i]!, oldNo: ++i, newNo: ++j });
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: a[i]!, oldNo: ++i });
    else out.push({ kind: "add", text: b[j]!, newNo: ++j });
  }
  while (i < n) out.push({ kind: "del", text: a[i]!, oldNo: ++i });
  while (j < m) out.push({ kind: "add", text: b[j]!, newNo: ++j });
  return out;
}

export function diffStats(d: DiffLine[]): { added: number; removed: number } {
  return { added: d.filter((x) => x.kind === "add").length, removed: d.filter((x) => x.kind === "del").length };
}
