import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  UtensilsCrossedIcon, PlusIcon, Trash2Icon, FlameIcon, ClockIcon, AppleIcon, SettingsIcon
} from 'lucide-angular';
import { SupabaseService } from '../../core/supabase.service';
import { environment } from '../../../environments/environment';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

type MealLog = {
  id: string;
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: MealType;
  logged_at: string; // ISO
};

type AnalysisItem = { name: string; qty: number; unit?: string; kcal: number };
type Analysis = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items: AnalysisItem[];
};

@Component({
  standalone: true,
  selector: 'nt-alimentation',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './alimentation.page.html',
  styleUrls: ['./alimentation.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AlimentationPage {
  // Icons
  readonly UtensilsCrossedIcon = UtensilsCrossedIcon;
  readonly PlusIcon = PlusIcon;
  readonly Trash2Icon = Trash2Icon;
  readonly FlameIcon = FlameIcon;
  readonly ClockIcon = ClockIcon;
  readonly AppleIcon = AppleIcon;
  readonly SettingsIcon = SettingsIcon;

  private supabase = inject(SupabaseService);

  // Estado base
  loading = signal(true);
  err = signal<string | null>(null);
  uid = signal<string | null>(null);

  // Meta kcal (fallback 2000)
  recKcal = signal<number>(2000);

  // Inputs
  mealType = signal<MealType>('breakfast');
  text = signal('');
  analyzing = signal(false);
  analysis = signal<Analysis | null>(null);
  analysisErr = signal<string | null>(null);

  // Hoy
  todayLogs = signal<MealLog[]>([]);

  /** Claves tipadas para iterar en el template */
  readonly mealKeys: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

  // Computados
  grouped = computed<Record<MealType, MealLog[]>>(() => {
    const g: Record<MealType, MealLog[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
    for (const m of this.todayLogs()) g[m.meal_type].push(m);
    return g;
  });

  todayTotal = computed(() =>
    this.todayLogs().reduce((a, b) => a + (b.calories || 0), 0)
  );

  pct = computed(() => {
    const goal = this.recKcal();
    const v = this.todayTotal();
    if (!goal || goal <= 0) return 0;
    const p = (v / goal) * 100;
    return Math.max(0, Math.min(100, +p.toFixed(1)));
  });

  // --------- Ciclo de vida ---------
  async ngOnInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      // Recomendación kcal si existe
      const { data: rec } = await this.supabase.client
        .from('user_recommendations')
        .select('goal_kcal')
        .eq('user_id', uid)
        .maybeSingle();
      if (rec?.goal_kcal) this.recKcal.set(Number(rec.goal_kcal));

      await this.loadToday();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar Alimentación.');
    } finally {
      this.loading.set(false);
    }
  }

  private startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
  private endOfToday()   { const d = this.startOfToday(); d.setDate(d.getDate()+1); return d; }

  async loadToday() {
    const { data, error } = await this.supabase.client
      .from('meal_logs')
      .select('id, description, calories, protein_g, carbs_g, fat_g, meal_type, logged_at')
      .eq('user_id', this.uid())
      .gte('logged_at', this.startOfToday().toISOString())
      .lt('logged_at', this.endOfToday().toISOString())
      .order('logged_at', { ascending: false });

    if (error) {
      this.err.set(error.message ?? 'No se pudo cargar el listado.');
      return;
    }

    this.todayLogs.set((data ?? []).map((r: any) => ({
      id: String(r.id),
      description: r.description,
      calories: Number(r.calories) || 0,
      protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
      meal_type: r.meal_type as MealType,
      logged_at: r.logged_at,
    })));
  }

  // ---- Helpers de error ----
  private stringifyBody(body: any): string | null {
    try {
      if (body == null) return null;
      if (typeof body === 'string') return body;
      const txt = JSON.stringify(body);
      return txt && txt !== '{}' ? txt : null;
    } catch { return null; }
  }

  private formatInvokeError(error: any, data: any): string {
    const status: number | undefined = error?.context?.status ?? error?.status;
    const bodyTxt = this.stringifyBody(error?.context?.body ?? data);
    let msg = `No se pudo analizar el texto (Open Food Facts).`;
    if (typeof status === 'number') msg += ` status=${status}`;
    if (error?.message) msg += ` – ${error.message}`;
    if (bodyTxt) msg += ` – ${bodyTxt}`;
    return msg;
  }

  // ---- API: analizar texto (Edge Function off-analyze) ----
  private async analyzeWithOFF(query: string): Promise<Analysis> {
    // 1) Llamada estándar via SDK (debería bastar)
    const { data, error } = await this.supabase.client.functions.invoke('off-analyze', {
      body: { query },
      headers: { 'Content-Type': 'application/json' },
    });

    if (error) {
      // 2) Fallback DIAGNÓSTICO: llamada directa para capturar el body real del error
      try {
        const url = `${environment.supabaseUrl}/functions/v1/off-analyze`;
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // apikey + Authorization con el anon Key (público)
            'apikey': environment.supabaseAnonKey,
            'Authorization': `Bearer ${environment.supabaseAnonKey}`,
          },
          body: JSON.stringify({ query }),
        });

        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          // Armamos un mensaje con el status real y el detalle del backend
          const detail = txt || (error?.context?.body ? JSON.stringify(error.context.body) : '');
          throw new Error(`No se pudo analizar el texto (Open Food Facts). status=${r.status} – ${detail || error?.message || 'Error'}`);
        }

        // Si el fallback directo respondió 200, usamos ese JSON como data
        const payload = await r.json();
        return {
          kcal: Number(payload?.kcal) || 0,
          protein_g: Number(payload?.protein_g) || 0,
          carbs_g: Number(payload?.carbs_g) || 0,
          fat_g: Number(payload?.fat_g) || 0,
          items: (payload?.items ?? []).map((f: any) => ({
            name: f.name, qty: Number(f.qty) || 0, unit: f.unit || undefined, kcal: Number(f.kcal) || 0,
          })),
        };
      } catch (e: any) {
        // Si también falla, mostramos un mensaje enriquecido
        throw new Error(this.formatInvokeError(error, data) + (e?.message ? ` | ${e.message}` : ''));
      }
    }

    // OK vía SDK
    const payload: any = data;
    return {
      kcal: Number(payload?.kcal) || 0,
      protein_g: Number(payload?.protein_g) || 0,
      carbs_g: Number(payload?.carbs_g) || 0,
      fat_g: Number(payload?.fat_g) || 0,
      items: (payload?.items ?? []).map((f: any) => ({
        name: f.name, qty: Number(f.qty) || 0, unit: f.unit || undefined, kcal: Number(f.kcal) || 0,
      })),
    };
  }

  async analyze() {
    this.analysis.set(null);
    this.analysisErr.set(null);
    const q = this.text().trim();
    if (!q) return;

    try {
      this.analyzing.set(true);
      const a = await this.analyzeWithOFF(q);
      this.analysis.set(a);
    } catch (e: any) {
      this.analysisErr.set(e?.message ?? 'No se pudo analizar el alimento.');
    } finally {
      this.analyzing.set(false);
    }
  }

  // ---- Persistencia ----
  private async addLog(payload: {
    description: string; calories: number;
    protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    meal_type: MealType;
  }) {
    const uid = this.uid(); if (!uid) return;

    // Optimista
    const optimistic: MealLog = {
      id: 'tmp_' + Math.random().toString(36).slice(2),
      description: payload.description,
      calories: payload.calories,
      protein_g: payload.protein_g, carbs_g: payload.carbs_g, fat_g: payload.fat_g,
      meal_type: payload.meal_type,
      logged_at: new Date().toISOString(),
    };
    this.todayLogs.set([optimistic, ...this.todayLogs()]);

    try {
      const { data, error } = await this.supabase.client
        .from('meal_logs')
        .insert({ user_id: uid, ...payload })
        .select('id, logged_at')
        .single();
      if (error) throw error;

      this.todayLogs.set(this.todayLogs().map(i => i.id === optimistic.id
        ? { ...optimistic, id: data.id, logged_at: data.logged_at }
        : i));
    } catch (e: any) {
      this.todayLogs.set(this.todayLogs().filter(i => i.id !== optimistic.id));
      this.err.set(e?.message ?? 'No se pudo guardar la comida.');
      setTimeout(() => this.err.set(null), 2200);
    }
  }

  async addFromAnalysis() {
    const a = this.analysis(); if (!a) return;
    await this.addLog({
      description: this.text().trim(),
      calories: a.kcal, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g,
      meal_type: this.mealType(),
    });
    this.text.set(''); this.analysis.set(null);
  }

  async addManual(calories: number) {
    calories = Math.max(0, Math.round(calories));
    if (!calories || !this.text().trim()) return;
    await this.addLog({
      description: this.text().trim(),
      calories, protein_g: null, carbs_g: null, fat_g: null,
      meal_type: this.mealType(),
    });
    this.text.set(''); this.analysis.set(null);
  }

  /** Prompt seguro (solo en cliente) para ingresar kcal manualmente */
  openManualPrompt() {
    if (typeof window === 'undefined') return; // SSR safe
    const raw = window.prompt('Ingresa kcal (estimado):', '300');
    const v = Number(raw ?? 0);
    if (!Number.isFinite(v) || v <= 0) return;
    void this.addManual(v);
  }

  async deleteLog(m: MealLog) {
    try {
      await this.supabase.client.from('meal_logs').delete().eq('id', m.id);
      this.todayLogs.set(this.todayLogs().filter(i => i.id !== m.id));
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo eliminar.');
      setTimeout(() => this.err.set(null), 2000);
    }
  }

  // ---- Helpers ----
  labelOf(t: MealType) {
    return t === 'breakfast' ? 'Desayuno'
      : t === 'lunch'     ? 'Almuerzo'
        : t === 'dinner'    ? 'Cena'
          : 'Snack';
  }

  groupList(k: MealType) { return this.grouped()[k]; }
  totalFor(k: MealType)  { return this.groupList(k).reduce((s, x) => s + (x.calories || 0), 0); }

  fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }
}
