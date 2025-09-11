// supabase/functions/delete-user/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Usa los secretos válidos (no empiezan con SUPABASE_)
    const SUPABASE_URL = Deno.env.get("MY_SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(
        JSON.stringify({ error: "Faltan env MY_SUPABASE_URL o MY_SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cliente con service_role para poder usar admin.deleteUser
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Requiere Authorization (el frontend lo envía automáticamente al invocar la función)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Espera cuerpo { userId: string }
    const { userId } = await req.json().catch(() => ({}));
    if (!userId || typeof userId !== "string") {
      return new Response(JSON.stringify({ error: "userId requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Puedes validar que el token pertenezca al mismo usuario que intenta borrar.

   const token = authHeader.replace("Bearer ", "");
    const { data: authed, error: getUserErr } = await admin.auth.getUser(token);
    if (getUserErr || !authed?.user || authed.user.id !== userId) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    }

    // 1) Borra al usuario en Auth
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) (Opcional) Limpieza de tablas propias
    // await admin.from('profiles').delete().eq('id', userId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
