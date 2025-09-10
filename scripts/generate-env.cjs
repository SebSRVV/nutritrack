// scripts/generate-env.cjs
const { writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

const envDir = resolve('./src/environments');
mkdirSync(envDir, { recursive: true });

/**
 * Lee variables desde Vercel.
 * Usa mayúsculas por convención, pero hacemos fallback a minúsculas
 * por si las creaste así (según tu captura).
 */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.supabaseUrl ||
  process.env.supabaseURL ||
  '';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.supabaseAnonKey ||
  process.env.supabase_anon_key ||
  '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[generate-env] ⚠️ Faltan SUPABASE_URL o SUPABASE_ANON_KEY (o sus variantes).');
  console.warn('                Configúralas en Vercel → Settings → Environment Variables.');
}

const file = (production) => `export const environment = {
  production: ${production},
  supabaseUrl: ${JSON.stringify(SUPABASE_URL)},
  supabaseAnonKey: ${JSON.stringify(SUPABASE_ANON_KEY)}
};
`;

writeFileSync(`${envDir}/environment.ts`, file(false));
writeFileSync(`${envDir}/environment.prod.ts`, file(true));

console.log('[generate-env] ✅ environment.ts y environment.prod.ts generados.');
