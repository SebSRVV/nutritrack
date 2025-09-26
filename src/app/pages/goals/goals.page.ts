import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { format, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import es from 'date-fns/locale/es';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ==== Supabase Config (usa tus envs) ====
const SUPABASE_URL = 'https://TU-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==== Tipos base ====
export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  target_per_week: number;     // cuántas veces por semana
  is_active: boolean;
  created_at: string;
}

export interface GoalProgress {
  id: string;
  goal_id: string;
  date: string;                // YYYY-MM-DD
  value: number;               // 0 o 1 (cumplido ese día)
  created_at: string;
}

@Component({
  selector: 'app-goals-page',
  templateUrl: './goals.page.html',
  styleUrls: ['./goals.page.css'],
})
export class GoalsPage implements OnInit {
  // Estado
  userId = signal<string | null>(null);
  loading = signal<boolean>(true);
  saving = signal<boolean>(false);
  goals = signal<Goal[]>([]);
  weekDays = signal<{ label: string; iso: string; short: string }[]>([]);
  progressMap = signal<Record<string, Record<string, number>>>({}); // goalId -> { 'YYYY-MM-DD': 0|1 }
  uiNewGoalOpen = signal<boolean>(false);
  uiEditGoalId = signal<string | null>(null);
  filterActive = signal<'all' | 'active' | 'inactive'>('all');
  search = signal<string>('');

  // Form meta (crear/editar)
  form = signal<{ title: string; description: string; target_per_week: number }>({
    title: '',
    description: '',
    target_per_week: 5,
  });

  // Computados
  filteredGoals = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filterActive();
    return this.goals().filter(g => {
      const byStatus = f === 'all' ? true : f === 'active' ? g.is_active : !g.is_active;
      const byText = !q || g.title.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q);
      return byStatus && byText;
    });
  });

  weekRangeLabel = computed(() => {
    const { start, end } = this.getWeekRange(new Date());
    const f = (d: Date) => format(d, "dd 'de' MMM", { locale: es });
    return `${f(start)} — ${f(end)}`;
  });

  constructor() {}

  async ngOnInit() {
    await this.ensureAuth();
    this.buildWeekDays();
    await this.loadGoalsAndProgress();
    this.loading.set(false);
  }

  // ==== Auth (saca user actual) ====
  private async ensureAuth() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      // Si no hay sesión, intenta con getSession (o redirige según tu app)
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      this.userId.set(uid);
    } else {
      this.userId.set(data.user.id);
    }
  }

  // ==== Semana actual y días ====
  private getWeekRange(date: Date) {
    // Semana inicia lunes (weekStartsOn:1)
    const start = startOfWeek(date, { weekStartsOn: 1 });
    const end = endOfWeek(date, { weekStartsOn: 1 });
    return { start, end };
  }

  private buildWeekDays() {
    const { start, end } = this.getWeekRange(new Date());
    const days = eachDayOfInterval({ start, end }).map(d => {
      const iso = format(d, 'yyyy-MM-dd');
      return {
        label: format(d, 'EEEE dd', { locale: es }), // lunes 23
        iso,
        short: format(d, 'EEE', { locale: es }),     // lun, mar...
      };
    });
    this.weekDays.set(days);
  }

  // ==== Carga de datos ====
  private async loadGoalsAndProgress() {
    const uid = this.userId();
    if (!uid) return;

    // metas
    const { data: goals, error: gErr } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });

    if (gErr) {
      console.error(gErr);
      return;
    }
    this.goals.set(goals ?? []);

    // progreso semana
    const { start, end } = this.getWeekRange(new Date());
    const startIso = format(start, 'yyyy-MM-dd');
    const endIso = format(end, 'yyyy-MM-dd');

    if (!goals?.length) {
      this.progressMap.set({});
      return;
    }

    const goalIds = goals.map(g => g.id);
    const { data: prog, error: pErr } = await supabase
      .from('goal_progress')
      .select('*')
      .in('goal_id', goalIds)
      .gte('date', startIso)
      .lte('date', endIso);

    if (pErr) {
      console.error(pErr);
      return;
    }

    const map: Record<string, Record<string, number>> = {};
    for (const g of goals) map[g.id] = {};
    for (const d of this.weekDays()) {
      for (const g of goals) map[g.id][d.iso] = 0;
    }
    (prog ?? []).forEach(e => {
      if (!map[e.goal_id]) map[e.goal_id] = {};
      map[e.goal_id][e.date] = e.value;
    });
    this.progressMap.set(map);
  }

  // ==== Helpers UI ====
  progressFor(goalId: string) {
    const pm = this.progressMap();
    const days = this.weekDays();
    const done = days.reduce((acc, d) => acc + (pm[goalId]?.[d.iso] ?? 0), 0);
    const goal = this.goals().find(g => g.id === goalId);
    const target = goal?.target_per_week ?? 1;
    const pct = Math.min(100, Math.round((done / target) * 100));
    return { done, target, pct };
  }

  isChecked(goalId: string, isoDate: string): boolean {
    return (this.progressMap()[goalId]?.[isoDate] ?? 0) === 1;
  }

  // ==== Acciones ====
  async toggleDaily(goal: Goal, isoDate: string) {
    try {
      this.saving.set(true);
      const current = this.isChecked(goal.id, isoDate) ? 1 : 0;
      const next = current === 1 ? 0 : 1;

      // upsert por (goal_id, date)
      const { error } = await supabase
        .from('goal_progress')
        .upsert(
          { goal_id: goal.id, date: isoDate, value: next },
          { onConflict: 'goal_id,date' }
        );

      if (error) throw error;

      // Actualiza estado local
      const pm = { ...this.progressMap() };
      pm[goal.id] = { ...(pm[goal.id] ?? {}) };
      pm[goal.id][isoDate] = next;
      this.progressMap.set(pm);
    } catch (e) {
      console.error(e);
      alert('No se pudo actualizar el día. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  openNew() {
    this.form.set({ title: '', description: '', target_per_week: 5 });
    this.uiNewGoalOpen.set(true);
    this.uiEditGoalId.set(null);
  }

  openEdit(goal: Goal) {
    this.form.set({
      title: goal.title,
      description: goal.description ?? '',
      target_per_week: goal.target_per_week,
    });
    this.uiEditGoalId.set(goal.id);
    this.uiNewGoalOpen.set(true);
  }

  async saveGoal() {
    const uid = this.userId();
    if (!uid) return;

    const payload = {
      title: this.form().title.trim(),
      description: this.form().description.trim(),
      target_per_week: Math.min(7, Math.max(1, Number(this.form().target_per_week))),
      is_active: true,
      user_id: uid,
    };

    if (!payload.title) {
      alert('Ponle un título a tu meta.');
      return;
    }

    try {
      this.saving.set(true);
      if (this.uiEditGoalId()) {
        const { error } = await supabase
          .from('goals')
          .update({
            title: payload.title,
            description: payload.description,
            target_per_week: payload.target_per_week,
          })
          .eq('id', this.uiEditGoalId());

        if (error) throw error;
      } else {
        const { error } = await supabase.from('goals').insert(payload);
        if (error) throw error;
      }

      await this.loadGoalsAndProgress();
      this.uiNewGoalOpen.set(false);
      this.uiEditGoalId.set(null);
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar la meta.');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActive(goal: Goal) {
    try {
      const { error } = await supabase
        .from('goals')
        .update({ is_active: !goal.is_active })
        .eq('id', goal.id);
      if (error) throw error;
      await this.loadGoalsAndProgress();
    } catch (e) {
      console.error(e);
      alert('No se pudo actualizar el estado.');
    }
  }

  async deleteGoal(goal: Goal) {
    if (!confirm(`¿Eliminar la meta "${goal.title}"? Esta acción no se puede deshacer.`)) return;
    try {
      const { error } = await supabase.from('goals').delete().eq('id', goal.id);
      if (error) throw error;
      await this.loadGoalsAndProgress();
    } catch (e) {
      console.error(e);
      alert('No se pudo eliminar la meta.');
    }
  }
}
