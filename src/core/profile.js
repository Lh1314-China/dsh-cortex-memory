import os from 'node:os';
import path from 'node:path';

function homeFromEnv(env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

export function detectProfileName({ argv = process.argv, env = process.env } = {}) {
  // Explicit CLI/profile-path args outrank an inherited DSH_PROFILE from the
  // desktop app; otherwise `dsh --profile clean` would still read desktop data.
  const args = Array.isArray(argv) ? argv.map(String) : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--profile' && args[index + 1]) return path.basename(args[index + 1].replace(/[\\/]+$/, ''));
    if (arg.startsWith('--profile=')) return path.basename(arg.slice('--profile='.length).replace(/[\\/]+$/, ''));
  }
  for (const arg of args) {
    const match = arg.match(/[\\/]profiles[\\/]([^\\/]+)[\\/]?$/);
    if (match) return match[1];
  }
  const fromEnv = String(env.DSH_PROFILE ?? '').trim();
  if (fromEnv) return fromEnv;
  return null;
}

export function profileDataRoot({ argv = process.argv, env = process.env } = {}) {
  const profile = detectProfileName({ argv, env });
  const home = homeFromEnv(env);
  // desktop is the historical default; never silently point it at an empty DB.
  if (!profile || profile === 'desktop') return path.join(home, 'cortex');
  return path.join(home, 'cortex', 'profiles', profile);
}
