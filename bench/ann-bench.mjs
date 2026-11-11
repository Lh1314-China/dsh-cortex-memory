import { createAnnIndex } from '../src/vector/ann.js';

function randomFactory(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeVector(random, dim = 64) {
  const value = Array.from({ length: dim }, () => random() * 2 - 1);
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0)) || 1;
  return value.map((item) => item / norm);
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const count = Number(process.argv[2] ?? 5000);
const queries = Number(process.argv[3] ?? 100);
const ef = Number(process.argv[4] ?? 120);
const random = randomFactory(20261111);
const items = Array.from({ length: count }, (_, index) => ({ id: `a${index}`, vector: makeVector(random) }));
const queryVectors = Array.from({ length: queries }, () => makeVector(random));
const ann = createAnnIndex({ M: 24, efConstruction: 200, efSearch: ef, seed: 20261111 });
const buildStart = performance.now();
ann.rebuild(items);
const buildMs = performance.now() - buildStart;

const exactTimes = [];
const annTimes = [];
const exactResults = [];
const annResults = [];
for (const query of queryVectors) {
  const exactStart = performance.now();
  const exact = items
    .map((item) => ({ id: item.id, score: cosine(item.vector, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  exactTimes.push(performance.now() - exactStart);
  exactResults.push(exact);

  const annStart = performance.now();
  const approx = ann.search(query, 10, { ef }).slice(0, 10);
  annTimes.push(performance.now() - annStart);
  annResults.push(approx);
}

let hits = 0;
let expectedTotal = 0;
for (let index = 0; index < exactResults.length; index += 1) {
  const expected = new Set(exactResults[index].map((item) => item.id));
  for (const item of annResults[index]) if (expected.has(item.id)) hits += 1;
  expectedTotal += expected.size;
}

console.log(JSON.stringify({
  count,
  queries,
  dim: 64,
  ef,
  buildMs: Math.round(buildMs * 100) / 100,
  recallAt10: expectedTotal ? Math.round((hits / expectedTotal) * 10000) / 10000 : null,
  exactP50Ms: Math.round((percentile(exactTimes, 50) ?? 0) * 1000) / 1000,
  annP50Ms: Math.round((percentile(annTimes, 50) ?? 0) * 1000) / 1000,
  exactP95Ms: Math.round((percentile(exactTimes, 95) ?? 0) * 1000) / 1000,
  annP95Ms: Math.round((percentile(annTimes, 95) ?? 0) * 1000) / 1000,
}, null, 2));
