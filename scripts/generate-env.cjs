// scripts/generate-env.cjs
const { writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

const envDir = resolve('src/environments');
mkdirSync(envDir, { recursive: true });

const pick = (...keys) => {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
};

const mask = (v) => {
  if (!v) return '(vacío)';
  if (v.length <= 8) return v[0] + '***' + v.slice(-1);
  return v.slice(0, 4) + '***' + v.slice(-4);
};

/** Supabase */
const SUPABASE_URL      = pick('SUPABASE_URL', 'supabaseUrl', 'supabaseURL');
const SUPABASE_ANON_KEY = pick('SUPABASE_ANON_KEY', 'supabaseAnonKey', 'supabase_anon_key');

/** Nutritionix */
const NUTRITIONIX_APP_ID  = pick('NUTRITIONIX_APP_ID',  'NUTRITIONIX_API_ID',  'nutritionixAppId',  'nutritionix_app_id');
const NUTRITIONIX_APP_KEY = pick('NUTRITIONIX_APP_KEY', 'NUTRITIONIX_API_KEY', 'nutritionixAppKey', 'nutritionix_app_key');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[generate-env] ⚠️ Faltan SUPABASE_URL o SUPABASE_ANON_KEY (o sus variantes).');
}
if (!NUTRITIONIX_APP_ID || !NUTRITIONIX_APP_KEY) {
  console.warn('[generate-env] ⚠️ Faltan NUTRITIONIX_APP_ID o NUTRITIONIX_APP_KEY (o sus variantes).');
}

const file = (production) => `export const environment = {
  production: ${production},
  supabaseUrl: ${JSON.stringify(SUPABASE_URL)},
  supabaseAnonKey: ${JSON.stringify(SUPABASE_ANON_KEY)},
  nutritionix: {
    appId: ${JSON.stringify(NUTRITIONIX_APP_ID)},
    appKey: ${JSON.stringify(NUTRITIONIX_APP_KEY)}
  }
};
`;

writeFileSync(`${envDir}/environment.ts`, file(false));
writeFileSync(`${envDir}/environment.prod.ts`, file(true));

console.log('[generate-env] ✅ environment.ts y environment.prod.ts generados.');
console.log(`[generate-env]    Supabase URL: ${SUPABASE_URL || '(vacío)'}`);
console.log(`[generate-env]    Supabase Key: ${mask(SUPABASE_ANON_KEY)}`);
console.log(`[generate-env]    Nutritionix App ID:  ${mask(NUTRITIONIX_APP_ID)}`);
console.log(`[generate-env]    Nutritionix App Key: ${mask(NUTRITIONIX_APP_KEY)}`);
