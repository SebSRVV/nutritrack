import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild,
  inject, signal, computed, PLATFORM_ID, OnDestroy, OnInit
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  FlameIcon, PieChartIcon, BarChart3Icon, LineChartIcon, CalendarIcon, SettingsIcon
} from 'lucide-angular';
import { SupabaseService } from '../../core/supabase.service';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type MealCategory =
  | 'frutas' | 'vegetales' | 'proteínas' | 'cereales'
  | 'lácteos' | 'grasas' | 'legumbres' | 'ultraprocesados'
  | 'bebidas' | 'otros';

type MealLog = {
  id: string;
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: MealType;
  logged_at: string; // ISO
  meal_categories?: MealCategory[] | null;
  ai_items?: Array<{ name: string; qty: number; unit?: string; kcal: number; categories?: MealCategory[]; }> | null;
};

@Component({
  standalone: true,
  selector: 'nt-alimentation-panel',
  templateUrl: './panel.page.html',
  styleUrls: ['./panel.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, LucideAngularModule],
})
export default class AlimentationPanelPage implements OnInit, AfterViewInit, OnDestroy {
  // Icons
  readonly FlameIcon = FlameIcon;
  readonly PieChartIcon = PieChartIcon;
  readonly BarChart3Icon = BarChart3Icon;
  readonly LineChartIcon = LineChartIcon;
  readonly CalendarIcon = CalendarIcon;
  readonly SettingsIcon = SettingsIcon;

  private supabase = inject(SupabaseService);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  // Estado
  loading = signal(true);
  err = signal<string | null>(null);
  uid = signal<string | null>(null);

  // Fecha seleccionada (yyyy-MM-dd)
  selectedDate = signal<string>(this.toInputDate(new Date()));

  // Objetivo kcal
  recKcal = signal<number>(2000);

  // Datos del día
  logs = signal<MealLog[]>([]);

  // Canvas refs
  @ViewChild('donut') donutRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mealsBar') mealsBarRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('catsBar') catsBarRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('timeline') timelineRef?: ElementRef<HTMLCanvasElement>;

  // Chart.js runtime
  private Chart: any | null = null;
  private charts: any[] = [];

  // ===== Aggregations =====
  totalKcal = computed(() => this.logs().reduce((s, x) => s + (x.calories || 0), 0));

  totalByMeal = computed<Record<MealType, number>>(() => {
    const b: Record<MealType, number> = { breakfast:0, lunch:0, dinner:0, snack:0 };
    for (const r of this.logs()) b[r.meal_type] += r.calories || 0;
    return b;
  });

  macros = computed(() => {
    let p = 0, c = 0, f = 0;
    for (const r of this.logs()) {
      p += Number(r.protein_g || 0);
      c += Number(r.carbs_g || 0);
      f += Number(r.fat_g || 0);
    }
    return { protein_g: +p.toFixed(1), carbs_g: +c.toFixed(1), fat_g: +f.toFixed(1) };
  });

  categoriesAgg = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of this.logs()) {
      const cats = (r.meal_categories || []);
      const kcal = r.calories || 0;
      if (cats.length) {
        for (const c of cats) map[c] = (map[c] || 0) + kcal;
      } else {
        map['otros'] = (map['otros'] || 0) + kcal;
      }
      for (const it of (r.ai_items || [])) {
        for (const c of (it.categories || [])) {
          map[c] = (map[c] || 0) + (it.kcal || 0);
        }
      }
    }
    return map;
  });

  timelineAgg = computed(() => {
    const buckets: Record<string, number> = {};
    for (const r of this.logs()) {
      const d = new Date(r.logged_at);
      const hh = d.toLocaleTimeString('es-PE', { hour: '2-digit', hour12: false });
      buckets[hh] = (buckets[hh] || 0) + (r.calories || 0);
    }
    const hours = Object.keys(buckets).sort();
    return { labels: hours, data: hours.map(h => buckets[h]) };
  });

  aiFlatItems = computed(() => {
    const out: Array<{name: string; qty: number; unit?: string; kcal: number; cats: string[]}> = [];
    for (const r of this.logs()) {
      for (const it of (r.ai_items || [])) {
        out.push({ name: it.name, qty: it.qty, unit: it.unit, kcal: it.kcal, cats: (it.categories || []) as string[] });
      }
    }
    return out.sort((a,b)=> (b.kcal||0)-(a.kcal||0));
  });

  pct = computed(() => {
    const goal = this.recKcal(); const v = this.totalKcal();
    if (!goal) return 0;
    return Math.max(0, Math.min(100, +((v/goal)*100).toFixed(1)));
  });

  // ===== Helpers fecha =====
  private toInputDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }
  private startOfLocalDay(dateStr: string) { return new Date(`${dateStr}T00:00:00`); }
  private nextLocalDay(dateStr: string) { const d = this.startOfLocalDay(dateStr); d.setDate(d.getDate()+1); return d; }

  // ===== Lifecycle =====
  async ngOnInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id; if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      // objetivo kcal si existe
      const { data: rec } = await this.supabase.client
        .from('user_recommendations')
        .select('goal_kcal')
        .eq('user_id', uid)
        .maybeSingle();
      if (rec?.goal_kcal) this.recKcal.set(Number(rec.goal_kcal));

      await this.loadDay();   // <- carga datos aquí (como en alimentation)
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }

  async ngAfterViewInit() {
    // cargar Chart.js solo en navegador y montar gráficos
    if (!this.isBrowser) return;
    const mod = await import('chart.js/auto');
    this.Chart = mod.default || mod;
    this.mountCharts();
  }

  ngOnDestroy() { this.destroyCharts(); }

  // ===== Data =====
  async loadDay() {
    const uid = this.uid(); if (!uid) return;
    const dateStr = this.selectedDate();
    const from = this.startOfLocalDay(dateStr).toISOString();
    const to   = this.nextLocalDay(dateStr).toISOString(); // EXCLUSIVO

    const { data, error } = await this.supabase.client
      .from('meal_logs')
      .select('id, description, calories, protein_g, carbs_g, fat_g, meal_type, logged_at, meal_categories, ai_items')
      .eq('user_id', uid)
      .gte('logged_at', from)
      .lt('logged_at', to)                 // <- fin exclusivo, evita TZ bugs
      .order('logged_at', { ascending: true });

    if (error) { this.err.set(error.message ?? 'Error cargando día.'); return; }

    this.logs.set((data ?? []).map((r:any)=>({
      id:String(r.id),
      description:r.description,
      calories:Number(r.calories)||0,
      protein_g:r.protein_g, carbs_g:r.carbs_g, fat_g:r.fat_g,
      meal_type:r.meal_type as MealType,
      logged_at:r.logged_at,
      meal_categories:r.meal_categories ?? null,
      ai_items:r.ai_items ?? null,
    })));

    if (this.Chart) this.updateCharts();
  }

  // ===== Charts =====
  private destroyCharts() { for (const c of this.charts) try { c.destroy(); } catch {} this.charts = []; }

  private mountCharts() {
    this.destroyCharts();

    // Donut macros
    const m = this.macros();
    if (this.donutRef?.nativeElement) {
      const donut = new this.Chart(this.donutRef.nativeElement.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Proteína (g)','Carbos (g)','Grasa (g)'],
          datasets: [{ data: [m.protein_g, m.carbs_g, m.fat_g] }]
        },
        options: { plugins: { legend: { position:'bottom', labels:{ usePointStyle:true } } }, cutout: '65%' }
      });
      this.charts.push(donut);
    }

    // Barras por tipo de comida
    const byMeal = this.totalByMeal();
    const mLabels = ['Desayuno','Almuerzo','Cena','Snack'];
    const mData = [byMeal.breakfast, byMeal.lunch, byMeal.dinner, byMeal.snack];
    if (this.mealsBarRef?.nativeElement) {
      const bar1 = new this.Chart(this.mealsBarRef.nativeElement.getContext('2d'), {
        type: 'bar',
        data: { labels: mLabels, datasets: [{ label: 'kcal', data: mData }] },
        options: { plugins: { legend: { display:false } }, scales: { y: { beginAtZero:true } } }
      });
      this.charts.push(bar1);
    }

    // Barras por categorías
    const cats = this.categoriesAgg();
    const cLabels = Object.keys(cats);
    const cData = cLabels.map(k => Math.round(cats[k]));
    if (this.catsBarRef?.nativeElement) {
      const bar2 = new this.Chart(this.catsBarRef.nativeElement.getContext('2d'), {
        type: 'bar',
        data: { labels: cLabels, datasets: [{ label: 'kcal por categoría', data: cData }] },
        options: { indexAxis: 'y', plugins: { legend: { display:false } }, scales: { x: { beginAtZero:true } } }
      });
      this.charts.push(bar2);
    }

    // Línea por hora
    const tl = this.timelineAgg();
    if (this.timelineRef?.nativeElement) {
      const line = new this.Chart(this.timelineRef.nativeElement.getContext('2d'), {
        type: 'line',
        data: { labels: tl.labels, datasets: [{ label: 'kcal por hora', data: tl.data, tension: .35, fill:false, pointRadius:3 }] },
        options: { plugins: { legend: { display:false } }, scales: { y: { beginAtZero:true } } }
      });
      this.charts.push(line);
    }
  }

  private updateCharts() { this.mountCharts(); }

  // ===== UI =====
  async onDateChange(v: string) {
    this.selectedDate.set(v);
    await this.loadDay();
  }

  mealLabel(t: MealType) {
    return t==='breakfast'?'Desayuno':t==='lunch'?'Almuerzo':t==='dinner'?'Cena':'Snack';
  }

  fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es-PE',{ hour:'2-digit', minute:'2-digit' });
  }
}
