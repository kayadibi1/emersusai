// Read a bench-matrix log file (stdin or arg) and print per-stack aggregates.
import fs from "node:fs";
const path = process.argv[2] || "/tmp/rerank-shootout.log";
const lines = fs.readFileSync(path, "utf8").split("\n");
let stack = null;
const acc = {};
for (const ln of lines) {
  const m = ln.match(/## Stack (\S+)/);
  if (m) {
    stack = m[1];
    if (!acc[stack]) acc[stack] = { n: 0, d10: 0, d100: 0, mrr: 0, err: 0, lat: 0 };
    continue;
  }
  if (!stack) continue;
  if (ln.includes("ERR:")) { acc[stack].err++; continue; }
  const r = ln.match(/doi@10=(\d+)%.*doi@100=(\d+)%.*mrr=([\d.]+)\s+(\d+)ms/);
  if (r) {
    acc[stack].n++;
    acc[stack].d10 += Number(r[1]);
    acc[stack].d100 += Number(r[2]);
    acc[stack].mrr += Number(r[3]);
    acc[stack].lat += Number(r[4]);
  }
}
const order = Object.keys(acc);
console.log("Stack  n   err  doi@10   doi@100  mrr     avg_latency");
for (const s of order) {
  const a = acc[s];
  if (a.n === 0) {
    console.log(`${s.padEnd(4)}   0  ${String(a.err).padStart(3)}   --       --       --      --`);
    continue;
  }
  const d10 = (a.d10 / a.n).toFixed(1);
  const d100 = (a.d100 / a.n).toFixed(1);
  const mrr = (a.mrr / a.n).toFixed(3);
  const lat = Math.round(a.lat / a.n);
  console.log(`${s.padEnd(4)} ${String(a.n).padStart(3)} ${String(a.err).padStart(3)}   ${d10}%${" ".repeat(Math.max(0, 6 - d10.length))} ${d100}%${" ".repeat(Math.max(0, 6 - d100.length))} ${mrr}   ${lat}ms`);
}
