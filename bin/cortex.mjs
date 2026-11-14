#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCortex } from '../src/service/cortex.js';
import { profileDataRoot } from '../src/core/profile.js';
import { createShioriImporter } from '../src/adapters/shiori.js';
import { exportMarkdown } from '../src/adapters/markdown.js';
import { importMarkdown } from '../src/adapters/markdown-import.js';
import { effectiveFeatures } from '../src/core/feature-overrides.js';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[arg.slice(2)] = argv[i + 1]; i += 1; }
      else out[arg.slice(2)] = true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function usage() {
  console.log(`dsh-cortex CLI (source only)

  --data <dir>      cortex data directory (default ~/.dsh/cortex-memory)

Commands:
  write --text <text> [--kind <kind>] [--importance 0.5]
  search --query <text> [--limit 10]
  self
  health
  guard
  import-shiori --root <shiori-data>
  export-md --dir <target>
  import-md --dir <vault> [--dry-run]
  bench [--count 10000] [--queries 100]
`);
}

export function resolveDataRoot(args = {}, env = process.env) {
  return path.resolve(args.data ?? env.CORTEX_HOME ?? profileDataRoot({ env }));
}

function main() {
  const args = parse(process.argv.slice(2));
  const command = args._[0];
  const dataRoot = resolveDataRoot(args);
  if (!command || command === 'help' || args.help) { usage(); return; }

  if (command === 'bench') {
    const count = Number(args.count ?? 10000);
    const queries = Number(args.queries ?? 100);
    import('../bench/run.js').then(({ runBenchmark }) => {
      const result = runBenchmark({ count, queries, vector: args.vector === true });
      console.log(JSON.stringify(result, null, 2));
    });
    return;
  }

  const baseConfig = { dataRoot, dbFile: path.join(dataRoot, 'cortex.sqlite') };
  const effective = effectiveFeatures(baseConfig);
  const cortex = createCortex({ config: { ...baseConfig, features: effective.features } });
  try {
    if (command === 'write') {
      const result = cortex.write({ text: args.text, kind: args.kind, importance: args.importance ? Number(args.importance) : undefined, explicit: true });
      console.log(JSON.stringify({ skipped: result.skipped, id: result.trace?.id, kind: result.trace?.kind }, null, 2));
      return;
    }
    if (command === 'search') {
      const result = cortex.search(args.query ?? '', { limit: Number(args.limit ?? 10) });
      for (const item of result.items) console.log(`[${item.layer}] ${item.score} ${item.id} ${item.title}\n  ${item.snippet}`);
      return;
    }
    if (command === 'self') { console.log(JSON.stringify(cortex.self(), null, 2)); return; }
    if (command === 'health') { console.log(JSON.stringify(cortex.health(), null, 2)); return; }
    if (command === 'guard') { console.log(JSON.stringify(cortex.guardian.check(), null, 2)); return; }
    if (command === 'import-shiori') {
      const importer = createShioriImporter({ cortex });
      console.log(JSON.stringify(importer.importFrom(args.root), null, 2));
      return;
    }
    if (command === 'export-md') {
      console.log(JSON.stringify(exportMarkdown(cortex, args.dir ?? path.join(dataRoot, 'mirror')), null, 2));
      return;
    }
    if (command === 'import-md') {
      console.log(JSON.stringify(importMarkdown(cortex, args.dir ?? process.cwd(), { dryRun: args['dry-run'] === true }), null, 2));
      return;
    }
    usage();
  } finally {
    cortex.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
