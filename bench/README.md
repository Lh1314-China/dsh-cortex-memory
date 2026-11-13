# Cortex benchmarks

## semantic-cn.js

Reproducible controlled Chinese retrieval probe.

```powershell
node bench/semantic-cn.js
```

It creates a temporary Cortex database, writes 12 controlled memories, runs
12 queries through full search and injection-tiered recall, and reports
recall@3, MRR@3, nDCG@3, p50 and p95. Output is written to
`bench/results/semantic-cn.json`.

This is deliberately labeled **synthetic-controlled**. It is not LoCoMo,
LongMemEval, MemoryAgentBench or an official score.

## LoCoMo / LongMemEval

Adapters live in `bench/locomo.js` and `bench/longmemeval.js`. They evaluate
retrieval only; do not claim official end-to-end QA scores from them.

## OCR / ASR

OCR and ASR microbenchmarks belong to `dsh-cortex-extractors`, because the
engine and model choices are external. The extractor package includes its
layout/TSV/empty-text/link tests. Real Chinese screenshot/audio accuracy needs
explicit samples and environments; no numbers are fabricated here.
