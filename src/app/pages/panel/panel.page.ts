import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import Chart, {
  ChartConfiguration,
  ChartOptions,
  ChartType,
  TooltipItem,
  registerables
} from 'chart.js/auto';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  ChevronLeftIcon, BarChart3Icon, ClockIcon, FlameIcon, PieChartIcon, ActivityIcon
} from 'lucide-angular';

Chart.register(...registerables);

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

type MealRow = {
  id: string;
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: MealType;
  logged_at: string; // ISO
};

@Component({
  standalone: true,
  selector: 'nt-food-panel',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './panel.page.html',
  styleUrls: ['./panel.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class PanelPage implements AfterViewInit, OnDestroy {
  // Icons
  readonly ChevronLeftIcon = ChevronLeftIcon;
  readonly BarChart3Icon = BarChart3Icon;
  readonly ClockIcon = ClockIcon;
  readonly FlameIcon = FlameIcon;
  readonly PieChartIcon = PieChartIcon;
  readonly ActivityIcon = ActivityIcon;

  private supabase = inject(SupabaseService);

  loading = signal(true);
  err = signal<string | null>(null);

  // Rango analizado (últimos 30 días)
  readonly days = 30;

  // Canvases
  @ViewChild('caloriesLine') caloriesLineRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('macrosStack') macrosStackRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('todayDonut')  todayDonutRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('typeBars')    typeBarsRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('topFoods')    topFoodsRef!: ElementRef<HTMLCanvasElement>;

  // Charts
  private charts: Array<Chart<any, any, any>> = [];

  // Datos agregados
  private rows: MealRow[] = [];
  today = new Date();

  // Resúmenes simples
  todayKcal = 0;
  todayProt = 0;
  todayCarb = 0;
  todayFat  = 0;

  // Empty states
  kcalEmpty = true;
  macroEmpty = true;
  typeEmpty = true;
  topEmpty = true;

  // ---------- Helpers de estilo ----------
  private readonly gridColor = 'rgba(231, 238, 247, 0.12)';
  private readonly tickColor = '#c9d6ea';
  private readonly axisTitleColor = '#c9d6ea';

  private baseOptions<TType extends ChartType>(yTitle?: string): ChartOptions<TType> {
    // Usamos objeto parcial y casteamos al final para evitar que TS pida TODAS las props
    const opts: any = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { labels: { color: this.tickColor } },
        tooltip: {
          backgroundColor: 'rgba(18,24,38,.95)',
          borderColor: 'rgba(255,255,255,.1)',
          borderWidth: 1,
          titleColor: '#e6edf6',
          bodyColor: '#dfe9fb',
          cornerRadius: 8,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: this.gridColor },
          ticks: { color: this.tickColor, maxRotation: 0 }
        },
        y: {
          beginAtZero: true,
          grid: { color: this.gridColor },
          ticks: { color: this.tickColor },
          title: yTitle ? { display: true, text: yTitle, color: this.axisTitleColor } : undefined
        }
      }
    };
    return opts as ChartOptions<TType>;
  }

  private dateKey(d: Date) { return d.toISOString().slice(0,10); }
  private fmtDateShort(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  // ---------- Ciclo ----------
  async ngAfterViewInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');

      const to = new Date(); to.setHours(0,0,0,0); to.setDate(to.getDate() + 1);
      const from = new Date(to); from.setDate(from.getDate() - this.days);

      const { data, error } = await this.supabase.client
        .from('meal_logs')
        .select('id, description, calories, protein_g, carbs_g, fat_g, meal_type, logged_at')
        .eq('user_id', uid)
        .gte('logged_at', from.toISOString())
        .lt('logged_at', to.toISOString())
        .order('logged_at', { ascending: true });

      if (error) throw error;

      this.rows = (data ?? []).map((r: any) => ({
        id: String(r.id),
        description: r.description || '',
        calories: Number(r.calories) || 0,
        protein_g: Number(r.protein_g ?? 0),
        carbs_g: Number(r.carbs_g ?? 0),
        fat_g: Number(r.fat_g ?? 0),
        meal_type: r.meal_type as MealType,
        logged_at: r.logged_at,
      }));

      this.computeToday();
      this.buildCharts(from, to);
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.charts.forEach(c => c?.destroy());
    this.charts = [];
  }

  // ---------- Agregaciones ----------
  private computeToday() {
    const today = new Date(); today.setHours(0,0,0,0);
    const next = new Date(today); next.setDate(today.getDate() + 1);
    const rows = this.rows.filter(r => {
      const d = new Date(r.logged_at);
      return d >= today && d < next;
    });
    this.todayKcal = rows.reduce((s, r) => s + r.calories, 0);
    this.todayProt = rows.reduce((s, r) => s + (r.protein_g || 0), 0);
    this.todayCarb = rows.reduce((s, r) => s + (r.carbs_g || 0), 0);
    this.todayFat  = rows.reduce((s, r) => s + (r.fat_g || 0), 0);
  }

  private buildCharts(from: Date, to: Date) {
    // 1) Eje de días
    const labels: string[] = [];
    const dayIdx: Record<string, number> = {};
    const cursor = new Date(from);
    while (cursor < to) {
      const key = this.dateKey(cursor);
      dayIdx[key] = labels.length;
      labels.push(this.fmtDateShort(cursor.toISOString()));
      cursor.setDate(cursor.getDate() + 1);
    }

    // 2) Series por día
    const kcal = new Array(labels.length).fill(0);
    const prot = new Array(labels.length).fill(0);
    const carb = new Array(labels.length).fill(0);
    const fat  = new Array(labels.length).fill(0);

    for (const r of this.rows) {
      const d = new Date(r.logged_at);
      const key = this.dateKey(d);
      const i = dayIdx[key];
      if (i === undefined) continue;
      kcal[i] += r.calories || 0;
      prot[i] += r.protein_g || 0;
      carb[i] += r.carbs_g || 0;
      fat[i]  += r.fat_g || 0;
    }

    // flags empty
    this.kcalEmpty = kcal.every(v => v === 0);
    this.macroEmpty = prot.every(v => v === 0) && carb.every(v => v === 0) && fat.every(v => v === 0);

    // 3) Por tipo de comida (totales en el rango)
    const byType = { breakfast:0, lunch:0, dinner:0, snack:0 } as Record<MealType, number>;
    for (const r of this.rows) byType[r.meal_type] += r.calories || 0;
    this.typeEmpty = Object.values(byType).every(v => v === 0);

    // 4) Top 10 comidas por calorías (suma por descripción)
    const map = new Map<string, number>();
    for (const r of this.rows) {
      const k = (r.description || '—').trim().toLowerCase();
      map.set(k, (map.get(k) || 0) + (r.calories || 0));
    }
    const top = [...map.entries()].sort((a,b) => b[1]-a[1]).slice(0,10);
    const topLabels = top.map(([k]) => k || '—');
    const topValues = top.map(([,v]) => Math.round(v));
    this.topEmpty = topValues.length === 0 || topValues.every(v => v === 0);

    // ---------- CHARTS ----------
    const make = <TType extends ChartType>(
      ref: ElementRef<HTMLCanvasElement>,
      cfg: ChartConfiguration<TType>
    ) => {
      const c = new Chart(ref.nativeElement, cfg);
      this.charts.push(c as unknown as Chart<any, any, any>);
      return c;
    };

    // Línea: kcal/día
    make<'line'>(this.caloriesLineRef, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'kcal/día',
          data: kcal,
          tension: 0.25,
          pointRadius: 2.5,
          fill: false
        }]
      },
      options: {
        ...this.baseOptions<'line'>('kcal'),
        plugins: {
          ...(this.baseOptions<'line'>().plugins as any),
          legend: { display: false },
          tooltip: {
            ...(this.baseOptions<'line'>().plugins!.tooltip as any),
            callbacks: {
              label: (ctx: TooltipItem<'line'>) => ` ${ctx.formattedValue} kcal`
            }
          }
        }
      }
    });

    // Stacked: macros/día (g)
    const baseBar = this.baseOptions<'bar'>('gramos');
    make<'bar'>(this.macrosStackRef, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Proteína (g)', data: prot },
          { label: 'Carbohidratos (g)', data: carb },
          { label: 'Grasas (g)', data: fat },
        ]
      },
      options: {
        ...baseBar,
        scales: {
          ['x']: { ...(baseBar.scales!['x'] as any), stacked: true },
          ['y']: { ...(baseBar.scales!['y'] as any), stacked: true, beginAtZero: true }
        },
        plugins: {
          ...(baseBar.plugins as any),
          tooltip: {
            ...(baseBar.plugins!.tooltip as any),
            callbacks: { label: (ctx: TooltipItem<'bar'>) => ` ${ctx.dataset.label}: ${ctx.formattedValue} g` }
          }
        }
      }
    });

    // Donut: hoy
    make<'doughnut'>(this.todayDonutRef, {
      type: 'doughnut',
      data: {
        labels: ['Proteína (g)','Carbohidratos (g)','Grasas (g)'],
        datasets: [{ data: [this.todayProt, this.todayCarb, this.todayFat] }]
      },
      options: {
        ...this.baseOptions<'doughnut'>(),
        plugins: {
          legend: { position: 'bottom', labels: { color: this.tickColor } as any },
          tooltip: {
            ...(this.baseOptions<'doughnut'>().plugins!.tooltip as any),
            callbacks: {
              label: (ctx: TooltipItem<'doughnut'>) => ` ${ctx.label}: ${ctx.formattedValue} g`
            }
          }
        },
        cutout: '55%'
      }
    });

    // Barras: por tipo
    make<'bar'>(this.typeBarsRef, {
      type: 'bar',
      data: {
        labels: ['Desayuno','Almuerzo','Cena','Snack'],
        datasets: [{ label: 'kcal', data: [byType.breakfast, byType.lunch, byType.dinner, byType.snack] }]
      },
      options: {
        ...this.baseOptions<'bar'>('kcal'),
        plugins: { ...(this.baseOptions<'bar'>().plugins as any), legend: { display: false } },
      }
    });

    // Barras horiz: top alimentos
    make<'bar'>(this.topFoodsRef, {
      type: 'bar',
      data: {
        labels: topLabels,
        datasets: [{ label: 'kcal acumuladas', data: topValues }]
      },
      options: {
        ...this.baseOptions<'bar'>('kcal'),
        indexAxis: 'y',
        plugins: {
          ...(this.baseOptions<'bar'>().plugins as any),
          legend: { display: false },
          tooltip: {
            ...(this.baseOptions<'bar'>().plugins!.tooltip as any),
            callbacks: { label: (ctx: TooltipItem<'bar'>) => ` ${ctx.label}: ${ctx.formattedValue} kcal` }
          }
        }
      }
    });
  }
}
