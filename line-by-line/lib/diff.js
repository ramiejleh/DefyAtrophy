/**
 * Line diff (Myers, O(ND)) with no dependencies.
 *
 * Returns a list of ops in file order: { op: "equal" | "delete" | "insert", a?: oldIndex, b?: newIndex }.
 * Deletes are emitted before inserts at the same position, which is how a reader expects a
 * replaced block to read: the old lines struck through, then the new ones.
 *
 * @param {string[]} a old lines
 * @param {string[]} b new lines
 */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ op: "equal", a: i, b: i });
  for (const op of myers(a.slice(start, endA), b.slice(start, endB))) {
    ops.push({ op: op.op, a: op.a === undefined ? undefined : op.a + start, b: op.b === undefined ? undefined : op.b + start });
  }
  for (let i = 0; endA + i < a.length; i++) ops.push({ op: "equal", a: endA + i, b: endB + i });
  return reorder(ops);
}

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((_, j) => ({ op: "insert", b: j }));
  if (!m) return a.map((_, i) => ({ op: "delete", a: i }));
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ op: "equal", a: --x, b: --y });
    if (d > 0) {
      if (x === prevX) ops.push({ op: "insert", b: --y });
      else ops.push({ op: "delete", a: --x });
    }
  }
  return ops.reverse();
}

/** Within each run of changes, put all deletes before all inserts. */
function reorder(ops) {
  const out = [];
  let dels = [];
  let ins = [];
  const flush = () => {
    out.push(...dels, ...ins);
    dels = [];
    ins = [];
  };
  for (const op of ops) {
    if (op.op === "equal") {
      flush();
      out.push(op);
    } else (op.op === "delete" ? dels : ins).push(op);
  }
  flush();
  return out;
}
