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

type Analysis = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items: Array<{ name: string; qty: number; unit?: string; kcal: number }>;
};

async function analyzeWithNutritionix(query: string): Promise<Analysis> {
  const appId  = environment.nutritionixAppId;
  const appKey = environment.nutritionixAppKey;

  const r = await fetch('https://trackapi.nutritionix.com/v2/natural/nutrients', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-id': appId,
      'x-app-key': appKey,
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error('No se pudo analizar el texto (Nutritionix).');
  const data = await r.json();

  const items = (data?.foods ?? []).map((f: any) => ({
    name: f.food_name,
    qty: f.serving_qty,
    unit: f.serving_unit,
    kcal: Number(f.nf_calories) || 0,
  }));

  const sum = (k: string) =>
    (data?.foods ?? []).reduce((acc: number, f: any) => acc + (Number(f[k]) || 0), 0);

  return {
    kcal: +sum('nf_calories').toFixed(0),
    protein_g: +sum('nf_protein').toFixed(1),
    carbs_g: +sum('nf_total_carbohydrate').toFixed(1),
    fat_g: +sum('nf_total_fat').toFixed(1),
    items,
  };
}

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
    const { data } = await this.supabase.client
      .from('meal_logs')
      .select('id, description, calories, protein_g, carbs_g, fat_g, meal_type, logged_at')
      .eq('user_id', this.uid())
      .gte('logged_at', this.startOfToday().toISOString())
      .lt('logged_at', this.endOfToday().toISOString())
      .order('logged_at', { ascending: false });

    this.todayLogs.set((data ?? []).map((r: any) => ({
      id: String(r.id),
      description: r.description,
      calories: Number(r.calories) || 0,
      protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
      meal_type: r.meal_type as MealType,
      logged_at: r.logged_at,
    })));
  }

  // ---- API: analizar texto ----
  async analyze() {
    this.analysis.set(null);
    this.analysisErr.set(null);
    const q = this.text().trim();
    if (!q) return;

    try {
      this.analyzing.set(true);
      const a = await analyzeWithNutritionix(q);
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

  /** Abre un prompt para ingresar kcal (evitamos usar prompt en el template) */
  openManualPrompt() {
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

  /** Listado por grupo para usar directo en *ngFor */
  groupList(k: MealType) {
    return this.grouped()[k];
  }

  /** Total de kcal por grupo para el resumen */
  totalFor(k: MealType) {
    return this.groupList(k).reduce((s, x) => s + (x.calories || 0), 0);
  }

  fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }
}
