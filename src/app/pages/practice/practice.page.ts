import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  HeartPulseIcon, PlusIcon, CheckIcon, Trash2Icon, RefreshCwIcon, ChevronRightIcon
} from 'lucide-angular';

type Suggestion = {
  id: number;
  practice_name: string;
  description: string | null;
  icon: string | null;
  frequency_target: number | null;
  sort_order: number | null;
};

type UserPractice = {
  id: string;
  user_id: string;
  practice_name: string;
  description: string | null;
  icon: string | null;
  frequency_target: number | null;
  sort_order: number | null;
  is_active: boolean;
};

type WeekMark = { date: string; done: boolean };

@Component({
  standalone: true,
  selector: 'nt-practices',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './practice.page.html',
  styleUrls: ['./practice.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class PracticePage {
  // Icons
  readonly HeartPulseIcon = HeartPulseIcon;
  readonly PlusIcon = PlusIcon;
  readonly CheckIcon = CheckIcon;
  readonly Trash2Icon = Trash2Icon;
  readonly RefreshCwIcon = RefreshCwIcon;
  readonly ChevronRightIcon = ChevronRightIcon;

  private supabase = inject(SupabaseService);

  // estado base
  loading = signal(true);
  saving = signal(false);
  err = signal<string | null>(null);

  uid = signal<string | null>(null);

  // data
  suggestions = signal<Suggestion[]>([]);
  myPractices = signal<UserPractice[]>([]);

  // mapas auxiliares
  // historial semanal por práctica (últimos 7 días, hoy inclusive)
  weekly = signal<Record<string, WeekMark[]>>({});
  // conteo semanal por práctica
  weeklyCount = signal<Record<string, number>>({});

  // panel de reemplazo
  replacingId = signal<string | null>(null);
  showSuggestions = signal<boolean>(false);

  // rango de semana
  private todayLocal = computed(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d;
  });

  weekDates = computed(() => {
    const end = this.todayLocal();
    const arr: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      arr.push(d);
    }
    return arr;
  });

  weekLabels = computed(() => this.weekDates().map(d =>
    d.toLocaleDateString(undefined, { weekday: 'short' })
  ));

  async ngOnInit() {
    try {
      this.loading.set(true);

      // usuario
      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      await Promise.all([
        this.loadSuggestions(),
        this.loadMyPracticesAndLogs()
      ]);
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar Prácticas.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadSuggestions() {
    const { data, error } = await this.supabase.client
      .from('default_practices')
      .select('id, practice_name, description, icon, frequency_target, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    this.suggestions.set((data ?? []) as Suggestion[]);
  }

  private async loadMyPracticesAndLogs() {
    const uid = this.uid()!;
    // prácticas del usuario
    const { data: up, error } = await this.supabase.client
      .from('user_practices')
      .select('id, user_id, practice_name, description, icon, frequency_target, sort_order, is_active')
      .eq('user_id', uid)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;

    const list = (up ?? []) as UserPractice[];
    this.myPractices.set(list);

    // si no hay prácticas, reset semanal
    if (list.length === 0) {
      this.weekly.set({});
      this.weeklyCount.set({});
      return;
    }

    // rango de semana
    const start = new Date(this.todayLocal());
    start.setDate(start.getDate() - 6);
    const startIso = start.toISOString().slice(0, 10); // YYYY-MM-DD
    const endIso = this.todayLocal().toISOString().slice(0, 10);

    // logs de la semana para todas las prácticas
    const ids = list.map(p => p.id);
    const { data: logs, error: lerr } = await this.supabase.client
      .from('practice_logs')
      .select('user_practice_id, date, done')
      .eq('user_id', uid)
      .in('user_practice_id', ids)
      .gte('date', startIso)
      .lte('date', endIso);
    if (lerr) throw lerr;

    // construir mapa fecha->done por práctica
    const byPractice: Record<string, Record<string, boolean>> = {};
    for (const p of list) byPractice[p.id] = {};
    for (const r of (logs ?? []) as Array<{user_practice_id: string; date: string; done: boolean}>) {
      byPractice[r.user_practice_id][r.date] = !!r.done;
    }

    const weekMarks: Record<string, WeekMark[]> = {};
    const weekCounts: Record<string, number> = {};
    for (const p of list) {
      const marks: WeekMark[] = this.weekDates().map(d => {
        const ymd = d.toISOString().slice(0,10);
        return { date: ymd, done: !!byPractice[p.id][ymd] };
      });
      weekMarks[p.id] = marks;
      weekCounts[p.id] = marks.reduce((s, m) => s + (m.done ? 1 : 0), 0);
    }

    this.weekly.set(weekMarks);
    this.weeklyCount.set(weekCounts);
  }

  // añadir desde sugerencias (o reemplazo)
  async addSuggestion(s: Suggestion) {
    try {
      this.saving.set(true);
      const uid = this.uid()!;
      // si es reemplazo, guardamos y eliminamos la anterior
      const replacing = this.replacingId();

      const { data, error } = await this.supabase.client
        .from('user_practices')
        .insert({
          user_id: uid,
          practice_name: s.practice_name,
          description: s.description,
          icon: s.icon,
          frequency_target: s.frequency_target ?? 7,
          sort_order: s.sort_order ?? 999,
          is_active: true,
        })
        .select('id')
        .single();
      if (error) throw error;

      if (replacing) {
        await this.removePractice(replacing, { silent: true });
        this.replacingId.set(null);
      }

      await this.loadMyPracticesAndLogs();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo agregar la práctica.');
    } finally {
      this.saving.set(false);
    }
  }

  // marcar / desmarcar cumplimiento para HOY
  async toggleToday(p: UserPractice) {
    try {
      this.saving.set(true);
      const uid = this.uid()!;
      const today = this.todayLocal().toISOString().slice(0,10);

      // ¿existe registro de hoy?
      const { data: existing } = await this.supabase.client
        .from('practice_logs')
        .select('id, done')
        .eq('user_id', uid)
        .eq('user_practice_id', p.id)
        .eq('date', today)
        .maybeSingle();

      if (existing?.id) {
        // toggle: si estaba done => borrar; si no => set done=true
        if (existing.done) {
          await this.supabase.client.from('practice_logs').delete().eq('id', existing.id);
        } else {
          await this.supabase.client.from('practice_logs').update({ done: true }).eq('id', existing.id);
        }
      } else {
        await this.supabase.client.from('practice_logs').insert({
          user_id: uid, user_practice_id: p.id, date: today, done: true
        });
      }

      await this.loadMyPracticesAndLogs();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo registrar el cumplimiento.');
    } finally {
      this.saving.set(false);
    }
  }

  // eliminar (desactivar) práctica
  async removePractice(id: string, opts: { silent?: boolean } = {}) {
    try {
      if (!opts.silent && !confirm('¿Eliminar esta práctica? Se mantendrá el historial.')) return;

      await this.supabase.client
        .from('user_practices')
        .update({ is_active: false })
        .eq('id', id);

      await this.loadMyPracticesAndLogs();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo eliminar la práctica.');
    }
  }

  // abrir panel de sugerencias (para nuevo o reemplazo)
  openSuggestions(replaceId?: string) {
    this.replacingId.set(replaceId ?? null);
    this.showSuggestions.set(true);
  }
  closeSuggestions() {
    this.replacingId.set(null);
    this.showSuggestions.set(false);
  }

  // helpers de UI
  iconOrFallback(i?: string | null) { return i && i.trim() ? i : '💡'; }
  countFor(id: string) { return this.weeklyCount()[id] ?? 0; }
  marksFor(id: string) { return this.weekly()[id] ?? []; }
}
