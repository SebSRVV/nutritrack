import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  TargetIcon, CheckCircle2Icon, PauseCircleIcon, CalendarDaysIcon,
  PlusIcon, SaveIcon, XIcon, PencilIcon, Trash2Icon, RocketIcon
} from 'lucide-angular';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

/** ===== Tipos ===== */
type WeekDay = { label: string; iso: string; short: string };

type Goal = {
  id: string;
  user_id: string;
  goal_name: string;
  description?: string | null;
  weekly_target: number;  // 1–7
  is_active: boolean;
  created_at: string;
  default_id?: number | null; // <- referencia a default_goals.id si proviene de un preset
};

type GoalProgressRow = { id: string; goal_id: string; log_date: string; value: number };

type DefaultGoal = {
  id: number;
  goal_name: string;
  goal_type: string;
  weekly_target: number;
  unit: string;
  target_value?: number;
  subtitle?: string | null;
};

type DefaultWithState = DefaultGoal & { is_active: boolean; bound_goal_id?: string | null };

/** ===== Helpers de fecha ===== */
function startOfWeekMonday(d0: Date): Date {
  const d = new Date(d0);
  const day = d.getDay();                // 0=Dom..6=Sáb
  const diff = (day === 0 ? -6 : 1 - day); // mover a lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}
function endOfWeekSunday(d0: Date): Date {
  const s = startOfWeekMonday(d0);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23,59,59,999);
  return e;
}
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth()+1}`.padStart(2,'0');
  const day = `${d.getDate()}`.padStart(2,'0');
  return `${y}-${m}-${day}`;
}
const fmtRange = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' });
const fmtDayFull  = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: '2-digit' });
const fmtDayShort = new Intl.DateTimeFormat('es-PE', { weekday: 'short' });

@Component({
  standalone: true,
  selector: 'nt-goals',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './goals.page.html',
  styleUrls: ['./goals.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('280ms cubic-bezier(.2,.8,.2,1)', style({ opacity: 1, transform: 'none' })),
        query('.card, .suggested-item', [
          style({ opacity: 0, transform: 'translateY(6px) scale(.98)' }),
          stagger(24, animate('220ms cubic-bezier(.2,.8,.2,1)', style({ opacity: 1, transform: 'none' })))
        ], { optional: true })
      ])
    ])
  ]
})
export class GoalsPage {
  // Icons
  readonly TargetIcon = TargetIcon;
  readonly CheckCircle2Icon = CheckCircle2Icon;
  readonly PauseCircleIcon = PauseCircleIcon;
  readonly CalendarDaysIcon = CalendarDaysIcon;
  readonly PlusIcon = PlusIcon;
  readonly SaveIcon = SaveIcon;
  readonly XIcon = XIcon;
  readonly PencilIcon = PencilIcon;
  readonly Trash2Icon = Trash2Icon;
  readonly RocketIcon = RocketIcon;

  private supabase = inject(SupabaseService);
  private router = inject(Router);

  /** ===== Estado base ===== */
  loading = signal(true);
  err = signal<string | null>(null);
  uid = signal<string | null>(null);

  goals = signal<Goal[]>([]);
  suggested = signal<DefaultGoal[]>([]); // siempre visible

  // map de defaults activos -> id de goal de usuario
  defaultsState = signal<Record<number, { goalId: string }>>({});

  // Semana y progreso
  weekDays = signal<WeekDay[]>([]);
  progressMap = signal<Record<string, Record<string, number>>>({}); // goalId -> { iso: 0|1 }

  // UI
  saving = signal(false);
  uiNewGoalOpen = signal(false);
  uiEditGoalId = signal<string | null>(null);

  filterActive = signal<'all' | 'active' | 'inactive'>('all');
  search = signal<string>('');

  // Form
  form = signal<{ title: string; description: string; target_per_week: number }>({
    title: '', description: '', target_per_week: 5
  });

  /** ====== Computados ====== */
  weekRangeLabel = computed(() => {
    const { start, end } = this.getWeekRange(new Date());
    return `${fmtRange.format(start)} — ${fmtRange.format(end)}`;
  });

  filteredGoals = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filterActive();
    // Sólo metas personales (no-presets) o todas? mantenemos todas, pero la UI oculta "Eliminar" si default_id
    return this.goals().filter(g => {
      const byStatus = f === 'all' ? true : f === 'active' ? g.is_active : !g.is_active;
      const byText = !q || g.goal_name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q);
      return byStatus && byText;
    });
  });

  // Defaults combinados con su estado actual
  defaultsWithState = computed<DefaultWithState[]>(() => {
    const defs = this.suggested();
    const st = this.defaultsState();
    return defs.map(d => ({
      ...d,
      is_active: !!st[d.id],
      bound_goal_id: st[d.id]?.goalId ?? null
    }));
  });

  /** ====== Ciclo de vida ====== */
  async ngOnInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      this.buildWeekDays();
      await this.loadGoalsAndProgress();
      await this.loadSuggestedDefaults();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar Metas.');
    } finally {
      this.loading.set(false);
    }
  }

  /** ====== Semana actual ====== */
  private getWeekRange(date: Date) {
    return { start: startOfWeekMonday(date), end: endOfWeekSunday(date) };
  }
  private buildWeekDays() {
    const { start } = this.getWeekRange(new Date());
    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({ label: fmtDayFull.format(d), iso: toIsoDate(d), short: fmtDayShort.format(d) });
    }
    this.weekDays.set(days);
  }

  /** ====== Carga principal ====== */
  private async loadGoalsAndProgress() {
    const uid = this.uid()!;
    // metas
    const { data: rows, error: gErr } = await this.supabase.client
      .from('user_goals')
      .select('id, user_id, goal_name, description, weekly_target, is_active, created_at, default_id')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });

    if (gErr) throw gErr;

    const list: Goal[] = (rows ?? []).map((g: any) => ({
      id: g.id,
      user_id: g.user_id,
      goal_name: g.goal_name ?? g.title ?? '',
      description: g.description ?? null,
      weekly_target: Number(g.weekly_target ?? g.target_per_week ?? 1),
      is_active: g.is_active ?? true,
      created_at: g.created_at,
      default_id: g.default_id ?? null,
    }));
    this.goals.set(list);

    // map default_id -> goalId
    const map: Record<number, { goalId: string }> = {};
    for (const g of list) if (g.default_id) map[g.default_id] = { goalId: g.id };
    this.defaultsState.set(map);

    // progreso de la semana
    const { start, end } = this.getWeekRange(new Date());
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(end);

    if (!list.length) { this.progressMap.set({}); return; }

    const goalIds = list.map(g => g.id);
    const { data: prog } = await this.supabase.client
      .from('user_goal_progress')
      .select('id, goal_id, log_date, value')
      .in('goal_id', goalIds)
      .gte('log_date', startIso)
      .lte('log_date', endIso);

    const pm: Record<string, Record<string, number>> = {};
    for (const g of list) pm[g.id] = {};
    for (const d of this.weekDays()) for (const g of list) pm[g.id][d.iso] = 0;
    (prog ?? []).forEach((e: GoalProgressRow) => {
      if (!pm[e.goal_id]) pm[e.goal_id] = {};
      pm[e.goal_id][e.log_date] = Number(e.value ?? 0);
    });
    this.progressMap.set(pm);
  }

  private async loadSuggestedDefaults() {
    // Trae todos los defaults (siempre visibles)
    const { data: defs } = await this.supabase.client
      .from('default_goals')
      .select('id, goal_name, goal_type, weekly_target, unit, target_value, subtitle')
      .order('id');

    this.suggested.set(defs ?? []);
  }

  /** ====== UI helpers ====== */
  isChecked(goalId: string, isoDate: string) {
    return (this.progressMap()[goalId]?.[isoDate] ?? 0) === 1;
  }
  progressFor(goalId: string) {
    const pm = this.progressMap();
    const days = this.weekDays();
    const done = days.reduce((acc, d) => acc + (pm[goalId]?.[d.iso] ?? 0), 0);
    const goal = this.goals().find(g => g.id === goalId);
    const target = Math.max(1, goal?.weekly_target ?? 1);
    const pct = Math.min(100, Math.round((done / target) * 100));
    return { done, target, pct };
  }

  /** ====== Acciones ====== */
  async toggleDaily(g: Goal, isoDate: string) {
    try {
      this.saving.set(true);
      const next = this.isChecked(g.id, isoDate) ? 0 : 1;

      const { error } = await this.supabase.client
        .from('user_goal_progress')
        .upsert(
          { user_id: this.uid(), goal_id: g.id, log_date: isoDate, value: next },
          { onConflict: 'goal_id,log_date' }
        );
      if (error) throw error;

      const pm = { ...this.progressMap() };
      pm[g.id] = { ...(pm[g.id] ?? {}) };
      pm[g.id][isoDate] = next;
      this.progressMap.set(pm);
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo actualizar el día.');
      setTimeout(() => this.err.set(null), 2000);
    } finally {
      this.saving.set(false);
    }
  }

  openNew() {
    this.form.set({ title: '', description: '', target_per_week: 5 });
    this.uiEditGoalId.set(null);
    this.uiNewGoalOpen.set(true);
  }
  openEdit(g: Goal) {
    this.form.set({ title: g.goal_name, description: g.description ?? '', target_per_week: g.weekly_target });
    this.uiEditGoalId.set(g.id);
    this.uiNewGoalOpen.set(true);
  }

  openEditDefault(d: DefaultWithState) {
    const g = this.goals().find(x => x.id === d.bound_goal_id);
    if (!g) return;
    this.openEdit(g);
  }

  async saveGoal() {
    const uid = this.uid(); if (!uid) return;
    const payload = {
      user_id: uid,
      goal_name: this.form().title.trim(),
      description: this.form().description.trim(),
      weekly_target: Math.min(7, Math.max(1, Number(this.form().target_per_week))),
      is_active: true,
      default_id: null
    };
    if (!payload.goal_name) { this.err.set('Ponle un título a tu meta.'); setTimeout(()=>this.err.set(null),1800); return; }

    try {
      this.saving.set(true);
      if (this.uiEditGoalId()) {
        const { error } = await this.supabase.client
          .from('user_goals')
          .update({ goal_name: payload.goal_name, description: payload.description, weekly_target: payload.weekly_target })
          .eq('id', this.uiEditGoalId());
        if (error) throw error;
        this.uiNewGoalOpen.set(false);
        this.uiEditGoalId.set(null);
      } else {
        const { data, error } = await this.supabase.client
          .from('user_goals')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        this.uiNewGoalOpen.set(false);
        this.uiEditGoalId.set(null);
        if (data?.id) {
          // Navegar al detalle del recien creado
          this.goTo({ ...payload, id: data.id, created_at: new Date().toISOString() } as any);
        }
      }
      await this.loadGoalsAndProgress();
      await this.loadSuggestedDefaults();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo guardar la meta.'); setTimeout(()=>this.err.set(null),2000);
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActive(g: Goal) {
    try {
      const { error } = await this.supabase.client.from('user_goals').update({ is_active: !g.is_active }).eq('id', g.id);
      if (error) throw error;
      await this.loadGoalsAndProgress();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cambiar el estado.'); setTimeout(()=>this.err.set(null),2000);
    }
  }

  async deleteGoal(g: Goal) {
    // No se eliminan metas que provienen de un preset
    if (g.default_id) return;
    if (!confirm(`¿Eliminar la meta "${g.goal_name}"?`)) return;
    try {
      const { error } = await this.supabase.client.from('user_goals').delete().eq('id', g.id);
      if (error) throw error;
      await this.loadGoalsAndProgress();
      await this.loadSuggestedDefaults();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo eliminar la meta.'); setTimeout(()=>this.err.set(null),2000);
    }
  }

  /** Activar / desactivar un preset (default_goals) con el pill */
  async toggleDefault(d: DefaultWithState) {
    const uid = this.uid(); if (!uid) return;
    try {
      if (d.is_active && d.bound_goal_id) {
        // Pausar el goal vinculado (no borrar)
        const { error } = await this.supabase.client
          .from('user_goals')
          .update({ is_active: false })
          .eq('id', d.bound_goal_id);
        if (error) throw error;
      } else {
        // Activar: si ya existe meta de ese default, reactivarla; si no, crear una
        const existing = this.goals().find(g => g.default_id === d.id);
        if (existing) {
          const { error } = await this.supabase.client
            .from('user_goals')
            .update({ is_active: true })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const payload = {
            user_id: uid,
            goal_name: d.goal_name,
            description: null,
            weekly_target: Math.min(7, Math.max(1, Number(d.weekly_target ?? d.target_value ?? 3))),
            is_active: true,
            default_id: d.id
          };
          const { data, error } = await this.supabase.client
            .from('user_goals')
            .insert(payload)
            .select('id')
            .single();
          if (error) throw error;
          if (data?.id) {
            // opcionalmente ir al detalle al activarlo
            this.goTo({ ...payload, id: data.id, created_at: new Date().toISOString() } as any);
          }
        }
      }
      await this.loadGoalsAndProgress();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cambiar el preset.'); setTimeout(()=>this.err.set(null),2000);
    }
  }

  /** Navegación */
  goTo(g: Goal) { this.router.navigate(['/goals', g.id]); }
  goToDefault(d: DefaultWithState) {
    if (d.bound_goal_id) {
      const g = this.goals().find(x => x.id === d.bound_goal_id);
      if (g) this.goTo(g);
    } else {
      // si está inactivo, activarlo al clic
      this.toggleDefault(d);
    }
  }
}
