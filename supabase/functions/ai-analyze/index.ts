// supabase/functions/ai-analyze/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/** ===== Tipos ===== */
type MealCategory =
  | "frutas" | "vegetales" | "proteínas" | "cereales"
  | "lácteos" | "grasas" | "legumbres" | "ultraprocesados"
  | "bebidas" | "otros";

type Payload =
  | { mode: "text"; query: string; hint_meal_type?: "breakfast" | "lunch" | "dinner" | "snack" }
  | { mode: "image"; image_url: string; hint_meal_type?: "breakfast" | "lunch" | "dinner" | "snack" };

/** ===== Config ===== */
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY no está definido en Supabase Secrets.");
}

// Modelos con visión y buen costo
const MODEL = "gpt-4o-mini";

/** ===== JSON Schema de salida ===== */
const schema = {
  type: "object",
  properties: {
    kcal: { type: "number" },
    protein_g: { type: "number" },
    carbs_g: { type: "number" },
    fat_g: { type: "number" },
    meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
    meal_categories: {
      type: "array",
      items: {
        enum: [
          "frutas","vegetales","proteínas","cereales","lácteos",
          "grasas","legumbres","ultraprocesados","bebidas","otros"
        ]
      }
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string" },
          kcal: { type: "number" },
          categories: {
            type: "array",
            items: {
              enum: [
                "frutas","vegetales","proteínas","cereales","lácteos",
                "grasas","legumbres","ultraprocesados","bebidas","otros"
              ]
            }
          }
        },
        required: ["name","qty","kcal","categories"],
        additionalProperties: false
      }
    }
  },
  required: ["kcal","protein_g","carbs_g","fat_g","meal_type","meal_categories","items"],
  additionalProperties: false
} as const;

/** ===== Helpers ===== */
function sysPrompt(hint?: string) {
  return `Eres un analista nutricional. Devuelve SOLO JSON válido con el siguiente esquema.
- Si hay cantidades, úsalas; si no, estima porciones comunes.
- Calorías y macros (protein_g, carbs_g, fat_g) en gramos totales de la comida.
- "items" contiene desglose por alimento con categorías (frutas, proteínas, etc.).
- Si hay ambigüedad, sé razonable y conservador.
${hint ? `Forzar meal_type = ${hint}.` : ""}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

/** ===== Main ===== */
Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    const body = (await req.json()) as Payload;

    // Construimos mensajes para chat/completions (texto o visión)
    const messages =
      body.mode === "text"
        ? ([
          { role: "system", content: sysPrompt(body.hint_meal_type) },
          { role: "user", content: `Texto: ${body.query}` }
        ] as any)
        : ([
          { role: "system", content: sysPrompt(body.hint_meal_type) },
          {
            role: "user",
            content: [
              { type: "text", text: "Analiza la comida de la imagen." },
              { type: "image_url", image_url: { url: body.image_url } }
            ]
          }
        ] as any);

    // Llamada a Chat Completions con JSON Schema
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        // Chat Completions soporta "response_format" (JSON schema)
        response_format: {
          type: "json_schema",
          json_schema: { name: "nutrition_schema", schema }
        }
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: data?.error ?? "OpenAI error", detail: data }),
        { status: r.status, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const text = data?.choices?.[0]?.message?.content;
    // A veces el modelo devuelve ya-objeto, pero normalmente es string JSON
    const parsed = typeof text === "string" ? JSON.parse(text) : text;

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
});
