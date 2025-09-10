import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const envDir = resolve('./src/environments');
mkdirSync(envDir, { recursive: true });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[generate-env] ⚠️ Variables no definidas. El build fallará en producción.');
}

const file = (production) => `
export const environment = {
  production: ${production},
  supabaseUrl: '${SUPABASE_URL}',
  supabaseAnonKey: '${SUPABASE_ANON_KEY}'
};
`;

writeFileSync(`${envDir}/environment.ts`, file(false));
writeFileSync(`${envDir}/environment.prod.ts`, file(true));

console.log('[generate-env] ✅ environment.ts y environment.prod.ts generados.');
