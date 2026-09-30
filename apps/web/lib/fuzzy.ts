// Owner task: EB-101 Command palette and global search — small fuzzy matcher for the quick switcher.
/** 0 = no match. Higher is better: exact > prefix > word prefix > substring > ordered letters. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s/·\-–—]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  let qi = 0;
  let gaps = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (prev >= 0 && ti !== prev + 1) gaps++;
      prev = ti;
      qi++;
    }
  }
  return qi === q.length ? Math.max(1, 20 - gaps) : 0;
}
