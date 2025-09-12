import {
  ChangeDetectionStrategy, Component, computed, inject, signal,
  ViewChild, ElementRef, AfterViewInit, PLATFORM_ID
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  FlameIcon, CalendarIcon, SettingsIcon,
  PieChartIcon, BarChart3Icon, LineChartIcon
} from 'lucide-angular';
import { SupabaseService } from '../../core/supabase.service';

/* ===== Tipos ===== */
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
  logged_at: string;               // ISO
  meal_categories?: MealCategory[] | null; // tags del registro
  ai_items?: Array<{
    name: string; qty: number; unit?: string; kcal: number;
    categories?: MealCategory[];
  }> | null;
};

@Component({
  standalone: true,
  selector: 'nt-panel',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './panel.page.html',
  styleUrls: ['./panel.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class PanelPage implements AfterViewInit {
  // Icons
  readonly FlameIcon = FlameIcon;
  readonly CalendarIcon = CalendarIcon;
  readonly SettingsIcon = SettingsIcon;
  readonly PieChartIcon = PieChartIcon;
  readonly BarChart3Icon = BarChart3Icon;
  readonly LineChartIcon = LineChartIcon;

  private supabase = inject(SupabaseService);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  // Estado base
  loading = signal(true);
  err = signal<string | null>(null);
  uid = signal<string | null>(null);

  // Fecha seleccionada (YYYY-MM-DD)
  selectedDate = signal<string>(this.toDateInputValue(new Date()));

  // Recomendación kcal (fallback)
  recKcal = signal<number>(2000);

  // Datos del día
  logs = signal<MealLog[]>([]);

  // ======= Computados =======
  totalKcal = computed(() => this.logs().reduce((a,b) => a + (b.calories || 0), 0));
  pct = computed(() => {
    const g = this.recKcal() || 1;
    const p = (this.totalKcal() / g) * 100;
    return Math.max(0, Math.min(100, +p.toFixed(1)));
  });
  macros = computed(() => {
    let p=0,c=0,f=0;
    for (const l of this.logs()) {
      p += Number(l.protein_g ?? 0);
      c += Number(l.carbs_g   ?? 0);
      f += Number(l.fat_g     ?? 0);
    }
    return { protein_g: Math.round(p), carbs_g: Math.round(c), fat_g: Math.round(f) };
  });

  /** Items planos de IA (para la tabla) */
  aiFlatItems = computed(() => {
    const out: { name:string; qty:number; unit?:string; kcal:number; cats: string[] }[] = [];
    for (const l of this.logs()) {
      const items = Array.isArray(l.ai_items) ? l.ai_items : [];
      for (const it of items) {
        out.push({
          name: it.name, qty: it.qty, unit: it.unit, kcal: Math.round(it.kcal),
          cats: Array.isArray(it.categories) && it.categories.length ? it.categories : ['otros']
        });
      }
    }
    // ordenar por kcal desc
    out.sort((a,b)=>b.kcal-a.kcal);
    return out;
  });

  // ======= Canvas refs =======
  @ViewChild('donut')     donutRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mealsBar')  mealsBarRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('catsBar')   catsBarRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('timeline')  timelineRef?: ElementRef<HTMLCanvasElement>;

  // ======= Chart.js =======
  private Chart: any;
  private charts: any[] = [];

  // ======= Paleta + helpers =======
  private COL = {
    text: '#e8eef8',
    grid: 'rgba(255,255,255,.12)',
    protein: '#22d3ee',
    carbs:   '#a78bfa',
    fat:     '#f59e0b',
    breakfast: '#38bdf8',
    lunch:     '#22d3ee',
    dinner:    '#a78bfa',
    snack:     '#10b981',
  };
  private catColorPool = ['#22d3ee','#a78bfa','#10b981','#38bdf8','#f59e0b','#fb7185','#84cc16','#f472b6','#6366f1','#06b6d4'];
  private hexToRgba(hex: string, a = 1) {
    const n = hex.replace('#','');
    const r = parseInt(n.substring(0,2),16);
    const g = parseInt(n.substring(2,4),16);
    const b = parseInt(n.substring(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  private colorsFor(labels: string[]) {
    return labels.map((_,i)=> this.hexToRgba(this.catColorPool[i % this.catColorPool.length], .85));
  }

  // ======= Lifecycle =======
  async ngOnInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      // Kcal recomendadas
      const { data: rec } = await this.supabase.client
        .from('user_recommendations').select('goal_kcal').eq('user_id', uid).maybeSingle();
      if (rec?.goal_kcal) this.recKcal.set(Number(rec.goal_kcal));

      await this.loadDay(this.selectedDate());
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }

  async ngAfterViewInit() {
    if (!this.isBrowser) return;
    const mod = await import('chart.js/auto');
    this.Chart = mod.default || mod;

    // Defaults de tema oscuro
    this.Chart.defaults.color = this.COL.text;
    this.Chart.defaults.borderColor = this.COL.grid;
    this.Chart.defaults.font.family = `'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;

    // Si los datos ya están, monta
    this.mountCharts();
  }

  // ======= Carga de datos =======
  async loadDay(yyyyMMdd: string) {
    const uid = this.uid(); if (!uid) return;

    const start = new Date(yyyyMMdd + 'T00:00:00');
    const end   = new Date(start); end.setDate(end.getDate()+1);

    const { data, error } = await this.supabase.client
      .from('meal_logs')
      .select('id, description, calories, protein_g, carbs_g, fat_g, meal_type, logged_at, meal_categories, ai_items')
      .eq('user_id', uid)
      .gte('logged_at', start.toISOString())
      .lt('logged_at', end.toISOString())
      .order('logged_at', { ascending: true });

    if (error) {
      this.err.set(error.message ?? 'No se pudo cargar el día.');
      this.logs.set([]);
    } else {
      this.logs.set((data ?? []).map((r:any)=>({
        id:String(r.id), description:r.description, calories:Number(r.calories)||0,
        protein_g:r.protein_g, carbs_g:r.carbs_g, fat_g:r.fat_g,
        meal_type:r.meal_type as MealType, logged_at:r.logged_at,
        meal_categories: r.meal_categories ?? null,
        ai_items: Array.isArray(r.ai_items) ? r.ai_items : null,
      })));
    }

    // Render charts cuando haya canvas disponible
    if (this.isBrowser) queueMicrotask(()=> this.mountCharts());
  }

  // ======= Eventos UI =======
  onDateChange(v: string) {
    if (!v) return;
    this.selectedDate.set(v);
    void this.loadDay(v);
  }

  // ======= Aggregations =======
  private totalByMeal(): Record<MealType, number> {
    const d: Record<MealType, number> = {breakfast:0,lunch:0,dinner:0,snack:0};
    for (const l of this.logs()) d[l.meal_type] += (l.calories||0);
    return d;
  }

  private categoriesAgg(): Record<string, number> {
    const agg: Record<string, number> = {};
    for (const l of this.logs()) {
      const items = Array.isArray(l.ai_items) ? l.ai_items : [];
      if (items.length) {
        for (const it of items) {
          const cats = Array.isArray(it.categories)&&it.categories.length ? it.categories : ['otros'];
          for (const c of cats) agg[c] = (agg[c]||0) + (it.kcal||0)/cats.length;
        }
      } else if (Array.isArray(l.meal_categories) && l.meal_categories.length) {
        const per = (l.calories||0)/l.meal_categories.length;
        for (const c of l.meal_categories) agg[c] = (agg[c]||0) + per;
      } else {
        agg['otros'] = (agg['otros']||0) + (l.calories||0);
      }
    }
    return agg;
  }

  private timelineAgg(): { labels: string[]; data: number[] } {
    const map = new Map<string, number>();
    for (const l of this.logs()) {
      const d = new Date(l.logged_at);
      const hh = d.toLocaleTimeString('es-PE', { hour: '2-digit', hour12:false });
      const key = `${hh}:00`;
      map.set(key, (map.get(key)||0) + (l.calories||0));
    }
    const labels = Array.from(map.keys()).sort();
    const data = labels.map(k => Math.round(map.get(k) || 0));
    return { labels, data };
  }

  // ======= Charts =======
  private destroyCharts(){ for (const c of this.charts) try{ c.destroy(); }catch{} this.charts=[]; }

  private mountCharts() {
    if (!this.isBrowser || !this.Chart) return;
    this.destroyCharts();

    // Donut macros
    const m = this.macros();
    if (this.donutRef?.nativeElement) {
      const bg = [
        this.hexToRgba(this.COL.protein,.9),
        this.hexToRgba(this.COL.carbs,.9),
        this.hexToRgba(this.COL.fat,.9),
      ];
      const donut = new this.Chart(this.donutRef.nativeElement.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Proteína (g)','Carbos (g)','Grasa (g)'],
          datasets: [{ data: [m.protein_g, m.carbs_g, m.fat_g], backgroundColor: bg, borderWidth: 0 }]
        },
        options: {
          maintainAspectRatio:false, cutout:'66%',
          plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, color:this.COL.text } } }
        }
      });
      this.charts.push(donut);
    }

    // Barras por comida
    const bm = this.totalByMeal();
    const labelsMeals = ['Desayuno','Almuerzo','Cena','Snack'];
    const dataMeals   = [bm.breakfast, bm.lunch, bm.dinner, bm.snack];
    const barColors   = [
      this.hexToRgba(this.COL.breakfast,.9),
      this.hexToRgba(this.COL.lunch,.9),
      this.hexToRgba(this.COL.dinner,.9),
      this.hexToRgba(this.COL.snack,.9),
    ];
    if (this.mealsBarRef?.nativeElement) {
      const bar1 = new this.Chart(this.mealsBarRef.nativeElement.getContext('2d'), {
        type: 'bar',
        data: { labels: labelsMeals, datasets: [{ label:'kcal', data: dataMeals, backgroundColor: barColors, borderWidth:0 }] },
        options: {
          maintainAspectRatio:false,
          plugins:{ legend:{ display:false } },
          scales:{
            x:{ ticks:{ color:this.COL.text }, grid:{ color:this.COL.grid, drawBorder:false } },
            y:{ ticks:{ color:this.COL.text }, grid:{ color:this.COL.grid, drawBorder:false }, beginAtZero:true }
          }
        }
      });
      this.charts.push(bar1);
    }

    // Barras horizontales por categorías
    const cats = this.categoriesAgg();
    const cLabels = Object.keys(cats);
    const cData   = cLabels.map(k => Math.round(cats[k]));
    if (this.catsBarRef?.nativeElement) {
      const colors = this.colorsFor(cLabels);
      const bar2 = new this.Chart(this.catsBarRef.nativeElement.getContext('2d'), {
        type: 'bar',
        data: { labels: cLabels, datasets: [{ data: cData, backgroundColor: colors, borderWidth:0 }] },
        options: {
          indexAxis:'y', maintainAspectRatio:false,
          plugins:{ legend:{ display:false } },
          scales:{
            x:{ ticks:{ color:this.COL.text }, grid:{ color:this.COL.grid, drawBorder:false }, beginAtZero:true },
            y:{ ticks:{ color:this.COL.text }, grid:{ color:this.COL.grid, drawBorder:false } }
          }
        }
      });
      this.charts.push(bar2);
    }

    // Línea por hora
    const tl = this.timelineAgg();
    if (this.timelineRef?.nativeElement) {
      const ctx = this.timelineRef.nativeElement.getContext('2d')!;
      const h = this.timelineRef.nativeElement.clientHeight || 220;
      const grad = ctx.createLinearGradient(0,0,0,h);
      grad.addColorStop(0, this.hexToRgba(this.COL.protein,.35));
      grad.addColorStop(1, this.hexToRgba(this.COL.protein,.05));

      const line = new this.Chart(ctx, {
        type: 'line',
        data: {
          labels: tl.labels,
          datasets: [{
            data: tl.data,
            borderColor: this.hexToRgba(this.COL.protein,.95),
            backgroundColor: grad,
            pointBackgroundColor: this.hexToRgba(this.COL.protein,.95),
            pointRadius: 3, tension: .35, fill: true
          }]
        },
        options: {
          maintainAspectRatio:false,
          plugins:{ legend:{ display:false } },
          scales:{
            x:{ ticks:{ color:this.COL.text }, grid:{ color:this.COL.grid, drawBorder:false } },
            y:{ ticks:{ color:this.COL.text }, grid:{ color:this.COL.grid, drawBorder:false }, beginAtZero:true }
          }
        }
      });
      this.charts.push(line);
    }
  }

  // ======= Helpers =======
  mealLabel(t: MealType){
    return t==='breakfast' ? 'Desayuno'
      : t==='lunch' ? 'Almuerzo'
        : t==='dinner'? 'Cena' : 'Snack';
  }
  fmtTime(iso: string){
    return new Date(iso).toLocaleTimeString('es-PE',{hour:'2-digit', minute:'2-digit'});
  }
  private toDateInputValue(d: Date){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
}
