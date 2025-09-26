import {
  ChangeDetectionStrategy, Component, computed, inject, signal,
  HostListener, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';
import { LucideAngularModule, TrophyIcon, CalendarDaysIcon, ChevronLeftIcon,
  TargetIcon, Settings2Icon, ListChecksIcon, SaveIcon, XIcon } from 'lucide-angular';

/** ===== Tipos ===== */
type WeekDay = { label: string; iso: string; short: string };
type Goal = {
  id: string; user_id: string; goal_name: string;
  description?: string | null; weekly_target: number; is_active: boolean;
  created_at: string; default_id?: number | null;
};
type GoalProgressRow = { id: string; goal_id: string; log_date: string; value: number };

/** ===== Helpers de fecha ===== */
function startOfWeekMonday(d0: Date): Date {
  const d = new Date(d0); const day = d.getDay(); const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); return d;
}
function endOfWeekSunday(d0: Date): Date {
  const s = startOfWeekMonday(d0); const e = new Date(s);
  e.setDate(s.getDate() + 6); e.setHours(23,59,59,999); return e;
}
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtRange = new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'short'});
const fmtDayFull  = new Intl.DateTimeFormat('es-PE',{weekday:'long',day:'2-digit'});
const fmtDayShort = new Intl.DateTimeFormat('es-PE',{weekday:'short'});

@Component({
  standalone: true,
  selector: 'nt-goals',
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './goals.page.html',
  styleUrls: ['./goals.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px)' }),
        animate('220ms cubic-bezier(.2,.8,.2,1)', style({ opacity: 1, transform: 'none' })),
        query('.card', [
          style({ opacity: 0, transform: 'translateY(4px) scale(.98)' }),
          stagger(18, animate('200ms cubic-bezier(.2,.8,.2,1)', style({ opacity: 1, transform: 'none' })))
        ], { optional: true })
      ])
    ])
  ]
})
export class GoalsPage {
  // Icons
  readonly TrophyIcon = TrophyIcon;
  readonly CalendarDaysIcon = CalendarDaysIcon;
  readonly ChevronLeftIcon = ChevronLeftIcon;
  readonly TargetIcon = TargetIcon;
  readonly Settings2Icon = Settings2Icon;
  readonly ListChecksIcon = ListChecksIcon;
  readonly SaveIcon = SaveIcon;
  readonly XIcon = XIcon;

  @ViewChild('searchBox') searchBox!: ElementRef<HTMLInputElement>;

  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  // ===== Estado
  loading = signal(true);
  err = signal<string | null>(null);
  uid = signal<string | null>(null);

  goals = signal<Goal[]>([]);
  weekDays = signal<WeekDay[]>([]);
  progressMap = signal<Record<string, Record<string, number>>>({}); // goalId -> { iso: 0|1 }

  // UI
  saving = signal(false);
  uiNewGoalOpen = signal(false);
  uiEditGoalId = signal<string | null>(null);

  // Form
  form = signal<{ title: string; description: string; target_per_week: number }>({
    title: '', description: '', target_per_week: 5
  });

  // ===== Computados
  weekRangeLabel = computed(() => {
    const { start, end } = this.getWeekRange(new Date());
    return `${fmtRange.format(start)} — ${fmtRange.format(end)}`;
  });

  showEmpty = computed(() => !this.loading() && this.goals().length === 0);

  private progressStats = computed<Record<string, { done: number; target: number; pct: number }>>(() => {
    const pm = this.progressMap(); const days = this.weekDays();
    const map: Record<string, { done: number; target: number; pct: number }> = {};
    for (const g of this.goals()) {
      const done = days.reduce((acc, d) => acc + (pm[g.id]?.[d.iso] ?? 0), 0);
      const target = Math.max(1, g.weekly_target ?? 1);
      const pct = Math.min(100, Math.round((done / target) * 100));
      map[g.id] = { done, target, pct };
    }
    return map;
  });

  progressFor(goalId: string) { return this.progressStats()[goalId] ?? { done: 0, target: 1, pct: 0 }; }
  progressMood(pct: number) { return pct >= 80 ? 'good' : pct >= 40 ? 'warn' : 'bad'; }

  // trackBy
  trackByGoal = (_: number, g: Goal) => g.id;
  trackByDay = (_: number, d: WeekDay) => d.iso;

  // Atajos
  @HostListener('document:keydown', ['$event'])
  handleKeys(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.uiNewGoalOpen()) {
      e.preventDefault(); this.uiNewGoalOpen.set(false);
    }
  }

  // ===== Ciclo
  async ngOnInit() {
    try {
      this.loading.set(true);
      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id; if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      this.buildWeekDays();
      await this.loadGoalsAndProgress();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar Metas.');
    } finally {
      this.loading.set(false);
    }
  }

  // Semana
  private getWeekRange(date: Date) { return { start: startOfWeekMonday(date), end: endOfWeekSunday(date) }; }
  private buildWeekDays() {
    const { start } = this.getWeekRange(new Date());
    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      days.push({ label: fmtDayFull.format(d), iso: toIso(d), short: fmtDayShort.format(d) });
    }
    this.weekDays.set(days);
  }

  // Datos
  private async loadGoalsAndProgress() {
    const uid = this.uid()!;
    const { data: rows, error: gErr } = await this.supabase.client
      .from('user_goals')
      .select('id, user_id, goal_name, description, weekly_target, is_active, created_at, default_id')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (gErr) throw gErr;

    const list: Goal[] = (rows ?? []).map((g: any) => ({
      id: g.id, user_id: g.user_id,
      goal_name: g.goal_name ?? g.title ?? '',
      description: g.description ?? null,
      weekly_target: Number(g.weekly_target ?? g.target_per_week ?? 1),
      is_active: !!g.is_active, created_at: g.created_at, default_id: g.default_id ?? null
    }));
    this.goals.set(list);

    const { start, end } = this.getWeekRange(new Date());
    const startIso = toIso(start), endIso = toIso(end);

    if (!list.length) { this.progressMap.set({}); return; }

    const goalIds = list.map(g => g.id);
    const { data: prog, error: pErr } = await this.supabase.client
      .from('user_goal_progress')
      .select('id, goal_id, log_date, value')
      .in('goal_id', goalIds).gte('log_date', startIso).lte('log_date', endIso);
    if (pErr) throw pErr;

    const pm: Record<string, Record<string, number>> = {};
    for (const g of list) pm[g.id] = {};
    for (const d of this.weekDays()) for (const g of list) pm[g.id][d.iso] = 0;

    (prog ?? []).forEach((e: GoalProgressRow) => {
      if (!pm[e.goal_id]) pm[e.goal_id] = {};
      pm[e.goal_id][e.log_date] = Number(e.value ?? 0);
    });
    this.progressMap.set(pm);
  }

  // UI helpers
  isChecked(goalId: string, isoDate: string) {
    return (this.progressMap()[goalId]?.[isoDate] ?? 0) === 1;
  }

  // Acciones
  async toggleDaily(g: Goal, isoDate: string) {
    try {
      this.saving.set(true);
      const next = this.isChecked(g.id, isoDate) ? 0 : 1;
      const { error } = await this.supabase.client
        .from('user_goal_progress')
        .upsert({ user_id: this.uid(), goal_id: g.id, log_date: isoDate, value: next },
          { onConflict: 'goal_id,log_date' });
      if (error) throw error;

      const pm = { ...this.progressMap() };
      pm[g.id] = { ...(pm[g.id] ?? {}) }; pm[g.id][isoDate] = next;
      this.progressMap.set(pm);
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo actualizar el día.');
      setTimeout(() => this.err.set(null), 1800);
    } finally { this.saving.set(false); }
  }

  openNew() { /* no se usa (eliminar del UI) */ }
  openEdit(g: Goal) {
    this.form.set({ title: g.goal_name, description: g.description ?? '', target_per_week: g.weekly_target });
    this.uiEditGoalId.set(g.id); this.uiNewGoalOpen.set(true);
  }

  async saveGoal() {
    const uid = this.uid(); if (!uid) return;
    const payload = {
      goal_name: this.form().title.trim(),
      description: this.form().description.trim(),
      weekly_target: Math.min(7, Math.max(1, Number(this.form().target_per_week)))
    };
    if (!payload.goal_name) { this.err.set('Ponle un título a tu meta.'); setTimeout(()=>this.err.set(null),1500); return; }

    try {
      this.saving.set(true);
      const { error } = await this.supabase.client
        .from('user_goals')
        .update(payload)
        .eq('id', this.uiEditGoalId());
      if (error) throw error;

      this.uiNewGoalOpen.set(false); this.uiEditGoalId.set(null);
      await this.loadGoalsAndProgress();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo guardar la meta.');
      setTimeout(()=>this.err.set(null),1600);
    } finally { this.saving.set(false); }
  }

  /** Pill: izq=Inactivo, der=Activo */
  async toggleActiveSwitch(g: Goal) {
    const next = !g.is_active;
    const snapshot = this.goals();
    this.goals.set(snapshot.map(x => x.id === g.id ? ({ ...x, is_active: next }) : x));
    try {
      const { error } = await this.supabase.client.from('user_goals').update({ is_active: next }).eq('id', g.id);
      if (error) throw error;
    } catch (e:any) {
      this.goals.set(snapshot);
      this.err.set(e?.message ?? 'No se pudo cambiar el estado.');
      setTimeout(()=>this.err.set(null),1600);
    }
  }

  backToDashboard() { this.router.navigate(['/dashboard']); }
}
