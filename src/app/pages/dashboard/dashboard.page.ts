import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  ActivityIcon, TargetIcon, DropletsIcon, HeartPulseIcon, ChevronRightIcon,
  UtensilsCrossedIcon, SettingsIcon
} from 'lucide-angular';

type Sex = 'female' | 'male';
type ActivityLevel = 'sedentary' | 'moderate' | 'very_active';
type DietType = 'low_carb' | 'caloric_deficit' | 'surplus';

@Component({
  standalone: true,
  selector: 'nt-dashboard',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class DashboardPage {
  // Icons
  readonly ActivityIcon = ActivityIcon;
  readonly TargetIcon = TargetIcon;
  readonly UtensilsCrossedIcon = UtensilsCrossedIcon;
  readonly DropletsIcon = DropletsIcon;
  readonly HeartPulseIcon = HeartPulseIcon;
  readonly ChevronRightIcon = ChevronRightIcon;
  readonly SettingsIcon = SettingsIcon;

  private supabase = inject(SupabaseService);

  // Estado base
  loading = signal(true);
  err = signal<string | null>(null);

  // Perfil
  uid = signal<string | null>(null);
  sex = signal<Sex>('female');
  height = signal<number | null>(null);
  weight = signal<number | null>(null);
  dob = signal<string | null>(null);
  activity = signal<ActivityLevel>('moderate');
  diet = signal<DietType>('caloric_deficit');

  // Totales del día
  todayMeals = signal<number>(0);
  todayKcal = signal<number>(0);
  waterMl = signal<number>(0);

  // Recomendaciones (DB o fallback)
  recKcal = signal<number | null>(null);
  recWater = signal<number | null>(null);

  // Metas (conteo + muestra)
  goalsCount = signal(0);
  goalsSample = signal<Array<{ id: string; title: string; status: string }>>([]);

  // ---------- Computados ----------
  private ageYears = computed(() => {
    const s = this.dob();
    if (!s) return null;
    const d = new Date(s);
    const t = new Date();
    let a = t.getFullYear() - d.getFullYear();
    const m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
    return Math.max(a, 0);
  });

  bmi = computed(() => {
    const h = this.height(), w = this.weight();
    if (!h || !w) return null;
    const meters = h / 100;
    return +(w / (meters * meters)).toFixed(1);
  });

  bmiLabel = computed(() => {
    const v = this.bmi();
    if (v === null) return '—';
    if (v < 18.5)  return 'Bajo peso';
    if (v < 25)    return 'Saludable';
    if (v < 30)    return 'Sobrepeso';
    return 'Obesidad';
  });

  waterPct = computed(() => {
    const goal = this.recWater();
    const ml = this.waterMl();
    if (!goal || goal <= 0) return 0;
    const pct = (ml / goal) * 100;
    return pct > 100 ? 100 : pct < 0 ? 0 : +pct.toFixed(1);
  });

  // === NUEVO: % progreso de alimentación (kcal) ===
  foodPct = computed(() => {
    const goal = this.recKcal();
    const v = this.todayKcal();
    if (!goal || goal <= 0) return 0;
    const p = (v / goal) * 100;
    return Math.max(0, Math.min(100, +p.toFixed(1)));
  });

  // ---------- Helpers (fallback de recomendaciones) ----------
  private activityFactor(a: ActivityLevel): number {
    switch (a) {
      case 'sedentary':   return 1.2;
      case 'moderate':    return 1.55;
      case 'very_active': return 1.725;
      default:            return 1.2;
    }
  }
  private kcalAdj(d: DietType): number {
    switch (d) {
      case 'caloric_deficit': return 0.85; // -15%
      case 'surplus':         return 1.10; // +10%
      default:                return 1.00; // low_carb no ajusta kcal
    }
  }
  private waterFactorByAge(age: number): number {
    if (age < 30) return 35;      // ml/kg
    if (age <= 55) return 33;
    return 30;
  }
  private activityWaterBonus(a: ActivityLevel): number {
    if (a === 'moderate') return 500;
    if (a === 'very_active') return 1000;
    return 0;
  }
  private recomputeLocalRecommendations(): { kcal: number | null; water: number | null } {
    const h = this.height(), w = this.weight(), s = this.sex(), a = this.activity(), d = this.diet(), age = this.ageYears();
    if (!h || !w || !s || age === null) return { kcal: null, water: null };

    // BMR (Mifflin-St Jeor)
    const bmr = s === 'male'
      ? 10 * w + 6.25 * h - 5 * age + 5
      : 10 * w + 6.25 * h - 5 * age - 161;

    const tdee = bmr * this.activityFactor(a);
    const kcal = Math.round(tdee * this.kcalAdj(d));

    const base = this.waterFactorByAge(age) * w;
    const water = Math.max(1500, Math.round(base + this.activityWaterBonus(a)));

    return { kcal, water };
  }

  // ---------- Carga ----------
  async ngOnInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      // Perfil base
      const { data: prof, error: perr } = await this.supabase.client
        .from('profiles')
        .select('sex, dob, height_cm, weight_kg, activity_level, diet_type')
        .eq('id', uid)
        .single();
      if (perr) throw perr;

      this.sex.set((prof?.sex ?? 'female') as Sex);
      this.dob.set(prof?.dob ?? null);
      this.height.set(prof?.height_cm ?? null);
      this.weight.set(prof?.weight_kg ?? null);
      this.activity.set((prof?.activity_level ?? 'moderate') as ActivityLevel);
      this.diet.set((prof?.diet_type ?? 'caloric_deficit') as DietType);

      // Recomendaciones desde DB si existe fila
      const { data: rec } = await this.supabase.client
        .from('user_recommendations')
        .select('goal_kcal, water_ml')
        .eq('user_id', uid)
        .maybeSingle();

      if (rec?.goal_kcal && rec?.water_ml) {
        this.recKcal.set(Number(rec.goal_kcal));
        this.recWater.set(Number(rec.water_ml));
      } else {
        const f = this.recomputeLocalRecommendations();
        this.recKcal.set(f.kcal);
        this.recWater.set(f.water);
      }

      // Ventana de hoy (local)
      const start = new Date(); start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(start.getDate() + 1);

      // Comidas de hoy
      const { data: meals } = await this.supabase.client
        .from('meal_logs')
        .select('calories')
        .eq('user_id', uid)
        .gte('logged_at', start.toISOString())
        .lt('logged_at', end.toISOString());
      this.todayMeals.set(meals?.length ?? 0);
      this.todayKcal.set((meals ?? []).reduce((s: number, m: any) => s + (Number(m.calories) || 0), 0));

      // Agua de hoy
      const { data: waters } = await this.supabase.client
        .from('water_intake')
        .select('amount_ml')
        .eq('user_id', uid)
        .gte('logged_at', start.toISOString())
        .lt('logged_at', end.toISOString());
      this.waterMl.set((waters ?? []).reduce((s: number, r: any) => s + (Number(r.amount_ml) || 0), 0));

      // Metas (conteo + 3 recientes)
      const { data: goals } = await this.supabase.client
        .from('goals')
        .select('id, title, status')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(3);
      this.goalsSample.set(goals ?? []);

      const { count } = await this.supabase.client
        .from('goals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid);
      this.goalsCount.set(count ?? 0);

    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar el dashboard.');
    } finally {
      this.loading.set(false);
    }
  }
}
