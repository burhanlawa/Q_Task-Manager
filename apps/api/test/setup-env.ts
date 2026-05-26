import { readFileSync } from 'fs';
import { join } from 'path';

// Load the repo-root .env so tests see DATABASE_URL etc. We avoid an explicit
// dotenv dep — this is a 10-line parser good enough for KEY=value lines.
function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
loadEnvFile(join(__dirname, '..', '.env'));
