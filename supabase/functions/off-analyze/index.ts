import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type ParsedPart = { raw: string; term: string; qty: number; unit?: string };

function ok(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), { status, headers: CORS });
}
function err(error: string, message: string, status = 400, extra?: unknown) {
  const body = extra ? { error, message, ...extra } : { error, message };
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

/* ---------- Diccionario local por 100 g ---------- */
type Per100g = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
type FoodEntry = {
  name: string;
  aliases: string[];
  per100g: Per100g;
  unit_g?: number;
  cup_g?: number;
};

const DB: FoodEntry[] = [
  { name: "Huevo", aliases: ["huevo", "huevos", "egg", "eggs"], per100g: { kcal: 155, protein_g: 13.0, carbs_g: 1.1, fat_g: 11.0 }, unit_g: 50 },
  { name: "Arroz cocido", aliases: ["arroz", "arroz cocido", "rice", "arroz blanco"], per100g: { kcal: 130, protein_g: 2.7, carbs_g: 28.0, fat_g: 0.3 }, cup_g: 158 },
  { name: "Manzana", aliases: ["manzana", "apple", "manzanas"], per100g: { kcal: 52, protein_g: 0.3, carbs_g: 14.0, fat_g: 0.2 }, unit_g: 182 },
  { name: "Plátano", aliases: ["plátano", "platano", "banana", "banano"], per100g: { kcal: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3 }, unit_g: 118 },
  { name: "Pechuga de pollo (cocida)", aliases: ["pechuga de pollo", "pollo", "chicken breast"], per100g: { kcal: 165, protein_g: 31.0, carbs_g: 0.0, fat_g: 3.6 }, unit_g: 120 },
  { name: "Leche", aliases: ["leche", "milk"], per100g: { kcal: 42, protein_g: 3.4, carbs_g: 5.0, fat_g: 1.0 }, cup_g: 240 },
  { name: "Pan", aliases: ["pan", "bread"], per100g: { kcal: 265, protein_g: 9.0, carbs_g: 49.0, fat_g: 3.2 }, unit_g: 25 },
];

function findInDB(term: string): FoodEntry | undefined {
  const t = term.toLowerCase();
  return DB.find(e => e.aliases.some(a => t.includes(a.toLowerCase())));
}

function normalizeTerm(raw: string): string {
  let q = raw.toLowerCase().trim();
  if (q === "huevos") q = "huevo";
  if (q === "manzanas") q = "manzana";
  if (q.includes("arroz")) q = "arroz cocido";
  return q;
}

function parseParts(query: string): ParsedPart[] {
  return query
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(raw => {
      const re = /^(?<qty>\d+(?:[.,]\d+)?)\s*(?<unit>taza(?:s)?|cucharada(?:s)?|cucharadita(?:s)?|unidad(?:es)?|u(?:ds?)?|g|gr|gramo(?:s)?|ml|mililitro(?:s)?)?\s*(?<term>.+)$/i;
      const m = raw.match(re);
      if (m && m.groups) {
        let qty = Number(String(m.groups.qty).replace(",", "."));
        let unit = m.groups.unit?.toLowerCase();
        let term = normalizeTerm((m.groups.term || "").trim());

        if (unit) {
          if (/^gr?$|gramo/.test(unit)) unit = "g";
          else if (/^mililitro/.test(unit) || unit === "ml") unit = "ml";
          else if (/^cucharadita/.test(unit)) unit = "tsp";
          else if (/^cucharada/.test(unit)) unit = "tbsp";
          else if (/^taza/.test(unit)) unit = "cup";
          else if (/^u|unidad/.test(unit)) unit = "unit";
        }

        return { raw, term, qty, unit };
      }
      return { raw, term: normalizeTerm(raw), qty: 100, unit: "g" };
    });
}

/* Conversión usando DB local */
function gramsFromDB(entry: FoodEntry, qty: number, unit?: string): number | null {
  if (!unit) {
    if (entry.unit_g) return entry.unit_g * qty;   // 2 huevos -> 2 * 50 g
    if (entry.cup_g)  return entry.cup_g  * qty;   // 1 arroz -> 1 taza
    return qty; // último recurso: interpretar como gramos
  }
  if (unit === "g")  return qty;
  if (unit === "ml") return qty; // densidad ~1
  if (unit === "cup"  && entry.cup_g)  return entry.cup_g  * qty;
  if (unit === "unit" && entry.unit_g) return entry.unit_g * qty;
  if (unit === "tsp" || unit === "tbsp") return null; // sin densidad → OFF
  return null;
}

function scaleFromPer100g(per: Per100g, grams: number): Per100g {
  const f = grams / 100;
  return {
    kcal: +(per.kcal * f).toFixed(0),
    protein_g: +(per.protein_g * f).toFixed(1),
    carbs_g: +(per.carbs_g * f).toFixed(1),
    fat_g: +(per.fat_g * f).toFixed(1),
  };
}

/* ---------- Fallback: Open Food Facts ---------- */
type OffProduct = {
  product_name?: string;
  nutriments?: Record<string, number | string>;
  categories_tags?: string[];
  languages_tags?: string[];
};

function num(x: any): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function kcalFromNutriments(nutr: any, grams?: number, ml?: number): number | null {
  const kcal100 = num(nutr?.["energy-kcal_100g"]);
  if (kcal100 != null) {
    const base = grams ?? ml;
    return base != null ? +(kcal100 * (base / 100)).toFixed(0) : +kcal100.toFixed(0);
  }
  const kJ100 = num(nutr?.["energy_100g"]);
  if (kJ100 != null) {
    const kcal = kJ100 / 4.184;
    const base = grams ?? ml;
    return base != null ? +(kcal * (base / 100)).toFixed(0) : +kcal.toFixed(0);
  }
  return null;
}
function macroFromNutriments(nutr: any, key100g: string, grams?: number, ml?: number, digits = 1): number {
  const per100 = num(nutr?.[key100g]) ?? 0;
  const base = grams ?? ml ?? 100;
  return +((per100 * base) / 100).toFixed(digits);
}
function preferGenericEs(list: OffProduct[], plainTerm: string): OffProduct | null {
  if (!list.length) return null;
  const esList = list.filter(p => (p.languages_tags || []).some(t => /-es$|^es:?/.test(String(t))));
  const pool = esList.length ? esList : list;

  const term = plainTerm.toLowerCase();
  const preferCats: string[] = [];
  if (/arroz/.test(term)) preferCats.push("arroz", "rice", "arroz-cocido");
  if (/huevo/.test(term)) preferCats.push("huevo", "eggs");
  if (/manzana/.test(term)) preferCats.push("apple", "manzana", "frutas");
  if (/plátano|platano|banana/.test(term)) preferCats.push("banana", "plátano", "frutas");
  if (/pollo|pechuga/.test(term)) preferCats.push("pollo", "chicken");

  const withCats = pool
    .map(p => ({ p, cats: (p.categories_tags || []).map(c => c.toLowerCase()) }))
    .sort((a, b) => (b.cats?.length || 0) - (a.cats?.length || 0));

  for (const pref of preferCats) {
    const hit = withCats.find(x => x.cats?.some(c => c.includes(pref)));
    if (hit) return hit.p;
  }
  return pool.find(p => p?.nutriments && (p.nutriments["energy-kcal_100g"] != null || p.nutriments["energy_100g"] != null))
    || pool[0]
    || null;
}
async function searchOFF(term: string): Promise<OffProduct | null> {
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "10",
    tagtype_0: "languages",
    tag_contains_0: "contains",
    tag_0: "es",
    fields: "product_name,nutriments,categories_tags,languages_tags",
    sort_by: "unique_scans_n",
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;

  let r: Response;
  try { r = await fetch(url, { headers: { "Accept": "application/json" } }); }
  catch (e) { throw new Error(`fetch_failed:${String(e)}`); }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`off_http_${r.status}:${text.slice(0, 200)}`);
  }

  let data: any;
  try { data = await r.json(); }
  catch { throw new Error("off_bad_json"); }

  const list = (data?.products ?? []) as OffProduct[];
  if (!list.length) return null;
  return preferGenericEs(list, term);
}

/* ---------- Handler principal ---------- */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return err("method_not_allowed", "Usa POST", 405);

  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return err("bad_request", "Content-Type debe ser application/json", 400);

  let body: any;
  try { body = await req.json(); } catch { return err("bad_request", "JSON inválido en el cuerpo", 400); }

  const query = (body?.query ?? "").toString().trim();
  if (!query) return err("bad_request", "query requerido (string no vacío)", 400);

  try {
    const parts = parseParts(query);
    const items: Array<{ name: string; qty: number; unit?: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }> = [];

    for (const p of parts) {
      // 1) Intento con DB local
      const dbEntry = findInDB(p.term);
      if (dbEntry) {
        const gramsResolved = gramsFromDB(dbEntry, p.qty, p.unit);
        if (gramsResolved != null) {
          const scaled = scaleFromPer100g(dbEntry.per100g, gramsResolved);

          // Unidad “visible” en la respuesta:
          let resolvedUnit = p.unit;
          if (!resolvedUnit) {
            if (dbEntry.unit_g) resolvedUnit = "unit";
            else if (dbEntry.cup_g) resolvedUnit = "cup";
            else resolvedUnit = "g";
          }

          items.push({
            name: dbEntry.name,
            qty: p.qty,
            unit: resolvedUnit,
            kcal: scaled.kcal,
            protein_g: scaled.protein_g,
            carbs_g: scaled.carbs_g,
            fat_g: scaled.fat_g,
          });
          continue;
        }
        // si no pudimos convertir (p.ej. cucharadas), pasamos a OFF
      }

      // 2) Fallback OFF
      const prod = await searchOFF(p.term);
      if (!prod) {
        items.push({ name: p.term, qty: p.qty, unit: p.unit || "g", kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
        continue;
      }

      // Asumimos gramos/ml según unidad original
      let grams: number | undefined;
      let ml: number | undefined;
      if (p.unit === "g" || !p.unit) grams = p.qty;
      else if (p.unit === "ml") ml = p.qty;
      else if (p.unit === "tsp") ml = p.qty * 5;
      else if (p.unit === "tbsp") ml = p.qty * 15;
      else if (p.unit === "cup") ml = p.qty * 240;
      else if (p.unit === "unit") grams = 100 * p.qty; // sin peso conocido

      const nutr = prod.nutriments || {};
      const kcal = kcalFromNutriments(nutr, grams, ml) ?? 0;
      const protein_g = macroFromNutriments(nutr, "proteins_100g", grams, ml);
      const carbs_g   = macroFromNutriments(nutr, "carbohydrates_100g", grams, ml);
      const fat_g     = macroFromNutriments(nutr, "fat_100g", grams, ml);

      items.push({
        name: prod.product_name || p.term,
        qty: p.qty,
        unit: p.unit || (grams ? "g" : ml ? "ml" : undefined),
        kcal, protein_g, carbs_g, fat_g,
      });
    }

    const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g") =>
      +items.reduce((a, b) => a + (Number((b as any)[k]) || 0), 0).toFixed(k === "kcal" ? 0 : 1);

    return ok({
      kcal: sum("kcal"),
      protein_g: sum("protein_g"),
      carbs_g: sum("carbs_g"),
      fat_g: sum("fat_g"),
      items,
      source: "local+openfoodfacts",
    });
  } catch (e) {
    const msg = String(e || "");
    if (msg.startsWith("fetch_failed:")) return err("network_error", "Fallo al contactar Open Food Facts", 502, { detail: msg });
    if (msg.startsWith("off_http_")) {
      const m = msg.match(/^off_http_(\d+):(.*)$/);
      const status = m ? Number(m[1]) : 502;
      const detail = m ? m[2] : "";
      return err("off_http_error", "Open Food Facts respondió con error", 502, { status, detail });
    }
    if (msg === "off_bad_json") return err("off_bad_json", "Respuesta inválida de Open Food Facts", 502);
    return err("internal_error", "Error inesperado", 500, { detail: msg });
  }
});
