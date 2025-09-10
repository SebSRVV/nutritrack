import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  DropletsIcon, CupSodaIcon, RotateCcwIcon, CalendarDaysIcon,
  PencilIcon, Trash2Icon, PlusIcon, SaveIcon, XIcon, SettingsIcon
} from 'lucide-angular';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

type DayItem  = { date: string; label: string; total: number };
type Preset   = { id?: string; name: string; amount_ml: number; icon?: 'cup'|'bottle'; sort_order?: number };
type Intake   = { id: string; amount_ml: number; logged_at: string };

@Component({
  standalone: true,
  selector: 'nt-water',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './water.page.html',
  styleUrls: ['./water.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('280ms cubic-bezier(.2,.8,.2,1)', style({ opacity: 1, transform: 'none' })),
        query('.card, .preset', [
          style({ opacity: 0, transform: 'translateY(6px) scale(.98)' }),
          stagger(24, animate('220ms cubic-bezier(.2,.8,.2,1)', style({ opacity: 1, transform: 'none' })))
        ], { optional: true })
      ])
    ])
  ]
})
export default class WaterPage {
  // Icons
  readonly DropletsIcon = DropletsIcon;
  readonly CupSodaIcon = CupSodaIcon;
  readonly RotateCcwIcon = RotateCcwIcon;
  readonly CalendarDaysIcon = CalendarDaysIcon;
  readonly PencilIcon = PencilIcon;
  readonly Trash2Icon = Trash2Icon;
  readonly PlusIcon = PlusIcon;
  readonly SaveIcon = SaveIcon;
  readonly XIcon = XIcon;
  readonly SettingsIcon = SettingsIcon;

  private supabase = inject(SupabaseService);

  // ===== Estado base =====
  loading = signal(true);
  err = signal<string | null>(null);
  uid = signal<string | null>(null);

  goal = signal<number>(2000);

  // Semana
  week = signal<DayItem[]>([]);
  sel  = signal<number>(0);
  todayIndex = computed(() => this.week().findIndex(d => d.date === this.toYMD(new Date())));
  isToday = computed(() => this.sel() === this.todayIndex());

  // Entradas por día (YYYY-MM-DD -> Intake[])
  entriesByDate = signal<Record<string, Intake[]>>({});

  // Para “deshacer último”
  lastInsertId = signal<string | null>(null);

  // Presets / modal
  presets = signal<Preset[]>([]);
  showPresetModal = signal(false);
  editingPreset = signal<Preset | null>(null);

  // ====== UI Computados ======
  selectedDay = computed(() => this.week()[this.sel()]);
  selectedTotal = computed(() => this.selectedDay()?.total ?? 0);
  selectedEntries = computed(() => {
    const d = this.selectedDay();
    if (!d) return [];
    const list = this.entriesByDate()[d.date] ?? [];
    // más recientes primero
    return [...list].sort((a,b) => +new Date(b.logged_at) - +new Date(a.logged_at));
  });

  dayPct = computed(() => {
    const g = this.goal() || 1;
    const pct = (this.selectedTotal() / g) * 100;
    return Math.max(0, Math.min(100, +pct.toFixed(1)));
  });

  selectedDateLabel = computed(() => {
    const d = this.selectedDay(); if (!d) return '';
    const date = new Date(d.date + 'T00:00:00');
    return this.formatDateEs(date);
  });

  progressText = computed(() => `${this.selectedTotal()} ml de ${this.goal()} ml`);
  selectedLevel = computed<'low'|'mid'|'ok'>(() => this.levelFor(this.selectedTotal(), this.goal()));

  // ====== Ciclo de vida ======
  async ngOnInit() {
    try {
      this.loading.set(true);

      const { data: ures, error: uerr } = await this.supabase.client.auth.getUser();
      if (uerr) throw uerr;
      const uid = ures.user?.id;
      if (!uid) throw new Error('Sesión no válida');
      this.uid.set(uid);

      const { data: rec } = await this.supabase.client
        .from('user_recommendations')
        .select('water_ml')
        .eq('user_id', uid)
        .maybeSingle();
      if (rec?.water_ml) this.goal.set(Number(rec.water_ml));

      await this.loadWeek();
      await this.loadPresetsOrSeed();
    } catch (e: any) {
      this.err.set(e?.message ?? 'No se pudo cargar Agua.');
    } finally {
      this.loading.set(false);
    }
  }

  // ====== Semana / timeline ======
  private startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    const out = new Date(d);
    out.setDate(d.getDate() + diff);
    out.setHours(0, 0, 0, 0);
    return out;
  }
  private dayLabel(d: Date): string { return ['D','L','M','M','J','V','S'][d.getDay()]; }
  private toYMD(d: Date): string { return d.toISOString().slice(0,10); }
  private timeOf(ts: string){ return new Date(ts).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}); }

  private formatDateEs(d: Date): string {
    const dia = d.toLocaleDateString('es-PE', { weekday: 'long' });
    const num = d.getDate();
    return `${dia} ${num}`;
  }

  levelFor(total: number, goal: number): 'low'|'mid'|'ok' {
    const ratio = (goal || 1) ? total / (goal || 1) : 0;
    if (ratio >= 1) return 'ok';
    if (ratio >= 0.5) return 'mid';
    return 'low';
  }

  async loadWeek() {
    const uid = this.uid()!;
    const today = new Date();
    const start = this.startOfWeek(today);
    const end = new Date(start); end.setDate(start.getDate()+7);

    const days: DayItem[] = [];
    for (let i=0;i<7;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      days.push({ date: this.toYMD(d), label: this.dayLabel(d), total: 0 });
    }

    const { data: rows } = await this.supabase.client
      .from('water_intake')
      .select('id, amount_ml, logged_at')
      .eq('user_id', uid)
      .gte('logged_at', start.toISOString())
      .lt('logged_at', end.toISOString());

    // construir mapa YYYY-MM-DD -> entradas
    const map: Record<string, Intake[]> = {};
    for (const r of rows ?? []) {
      const y = this.toYMD(new Date(r.logged_at));
      (map[y] ||= []).push({ id: String((r as any).id), amount_ml: Number(r.amount_ml)||0, logged_at: r.logged_at });
    }
    // totales por día desde el mapa
    for (const d of days){
      d.total = (map[d.date] ?? []).reduce((acc, it) => acc + (it.amount_ml||0), 0);
    }

    this.entriesByDate.set(map);
    this.week.set(days);
    this.sel.set(this.todayIndex() >= 0 ? this.todayIndex() : 0);
  }

  selectDay(i: number){ this.sel.set(i); }
  isTodayIdx(i: number){ return i === this.todayIndex(); }

  // ====== Acciones ======
  async addPreset(ml: number){
    if (!this.isToday()) return; // solo se permite registrar en el día actual
    const uid = this.uid(); if(!uid) return;

    // Optimista: suma al total del día
    const w = [...this.week()];
    const i = this.sel();
    w[i] = { ...w[i], total: (w[i]?.total ?? 0) + ml };
    this.week.set(w);

    try{
      const { data, error } = await this.supabase.client
        .from('water_intake')
        .insert({ user_id: uid, amount_ml: ml })
        .select('id, amount_ml, logged_at')
        .single();
      if (error) throw error;

      // Guardar id para deshacer
      this.lastInsertId.set(data?.id ?? null);

      // Añadir a la lista de ingresos del día
      const day = this.selectedDay()?.date;
      if (day){
        const map = {...this.entriesByDate()};
        const list = map[day] ? [...map[day]] : [];
        list.push({ id: data.id, amount_ml: Number(data.amount_ml)||0, logged_at: data.logged_at });
        map[day] = list;
        this.entriesByDate.set(map);
      }
    }catch(e){
      // revertir total
      const back = [...this.week()];
      const i2 = this.sel();
      back[i2] = { ...back[i2], total: Math.max(0,(back[i2]?.total ?? 0) - ml) };
      this.week.set(back);
      this.err.set((e as any)?.message ?? 'No se pudo registrar el agua.');
      setTimeout(()=>this.err.set(null), 2200);
    }
  }

  async undoLast(){
    const id = this.lastInsertId();
    if (!id || !this.isToday()) return;
    try{
      const { data, error } = await this.supabase.client
        .from('water_intake')
        .delete()
        .eq('id', id)
        .select('id, amount_ml, logged_at')
        .maybeSingle();
      if (error) throw error;

      const ml = Number(data?.amount_ml) || 0;

      // actualizar total
      const w = [...this.week()];
      const i = this.sel();
      w[i] = { ...w[i], total: Math.max(0,(w[i]?.total ?? 0) - ml) };
      this.week.set(w);

      // quitar de la lista
      const y = data?.logged_at ? this.toYMD(new Date(data.logged_at)) : this.selectedDay()?.date;
      if (y){
        const map = {...this.entriesByDate()};
        map[y] = (map[y] ?? []).filter(e => e.id !== id);
        this.entriesByDate.set(map);
      }

      this.lastInsertId.set(null);
    }catch(e){
      this.err.set((e as any)?.message ?? 'No se pudo deshacer.');
      setTimeout(()=>this.err.set(null), 2000);
    }
  }

  async deleteEntry(it: Intake){
    try{
      const { error } = await this.supabase.client
        .from('water_intake')
        .delete()
        .eq('id', it.id);
      if (error) throw error;

      const y = this.toYMD(new Date(it.logged_at));
      const map = {...this.entriesByDate()};
      map[y] = (map[y] ?? []).filter(e => e.id !== it.id);
      this.entriesByDate.set(map);

      // bajar total del día correspondiente
      const w = [...this.week()];
      const i = w.findIndex(d => d.date === y);
      if (i >= 0){
        const newTotal = Math.max(0, (w[i].total || 0) - (it.amount_ml || 0));
        w[i] = { ...w[i], total: newTotal };
        this.week.set(w);
      }

      // si era el último insert “deshacer”, resetea
      if (this.lastInsertId() === it.id) this.lastInsertId.set(null);
    }catch(e:any){
      this.err.set(e?.message ?? 'No se pudo eliminar el registro.');
      setTimeout(()=>this.err.set(null), 2200);
    }
  }

  // ====== Presets ======
  private PERU_DEFAULTS: Preset[] = [
    { name:'Vaso pequeño (casa)', amount_ml:200,  icon:'cup',    sort_order:1 },
    { name:'Vaso mediano (casa)', amount_ml:300,  icon:'cup',    sort_order:2 },
    { name:'Vaso grande (casa)',  amount_ml:350,  icon:'cup',    sort_order:3 },
    { name:'Cielo 625 ml',        amount_ml:625,  icon:'bottle', sort_order:10 },
    { name:'Cielo 1 L',           amount_ml:1000, icon:'bottle', sort_order:11 },
    { name:'Cielo 2.5 L',         amount_ml:2500, icon:'bottle', sort_order:12 },
    { name:'San Luis 625 ml',     amount_ml:625,  icon:'bottle', sort_order:20 },
    { name:'San Luis 1 L',        amount_ml:1000, icon:'bottle', sort_order:21 },
    { name:'San Luis 2.5 L',      amount_ml:2500, icon:'bottle', sort_order:22 },
    { name:'San Mateo 600 ml',    amount_ml:600,  icon:'bottle', sort_order:30 },
    { name:'San Mateo 1 L',       amount_ml:1000, icon:'bottle', sort_order:31 },
    { name:'San Mateo 2.5 L',     amount_ml:2500, icon:'bottle', sort_order:32 },
  ];

  async loadPresetsOrSeed(){
    const uid = this.uid()!;
    const { data: list } = await this.supabase.client
      .from('water_presets')
      .select('id, name, amount_ml, icon, sort_order')
      .eq('user_id', uid)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (!list || list.length === 0){
      const seed = this.PERU_DEFAULTS.map(p => ({...p, user_id: uid}));
      await this.supabase.client.from('water_presets').insert(seed);
      const { data: after } = await this.supabase.client
        .from('water_presets')
        .select('id, name, amount_ml, icon, sort_order')
        .eq('user_id', uid)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      this.presets.set(after ?? []);
    } else {
      this.presets.set(list);
    }
  }

  // --- helpers modal ---
  private updateEditingPreset(p: Partial<Preset>){
    const cur = this.editingPreset(); if (!cur) return;
    this.editingPreset.set({ ...cur, ...p });
  }
  onPresetNameInput(ev: Event){ this.updateEditingPreset({ name: (ev.target as HTMLInputElement).value ?? '' }); }
  onPresetAmountInput(ev: Event){
    const v = Number((ev.target as HTMLInputElement).value);
    this.updateEditingPreset({ amount_ml: isNaN(v) ? 0 : v });
  }
  onPresetIconChange(ev: Event){
    const v = (ev.target as HTMLSelectElement).value as 'cup' | 'bottle';
    this.updateEditingPreset({ icon: v || 'bottle' });
  }

  openAdd(){ this.editingPreset.set({ name:'', amount_ml:300, icon:'cup' }); this.showPresetModal.set(true); }
  openEdit(p: Preset){ this.editingPreset.set({ ...p }); this.showPresetModal.set(true); }
  closePresetModal(){ this.showPresetModal.set(false); this.editingPreset.set(null); }

  async savePreset(){
    const p = this.editingPreset(); if(!p) return;
    try{
      if (p.id){
        const { error } = await this.supabase.client
          .from('water_presets')
          .update({ name: p.name, amount_ml: p.amount_ml, icon: p.icon })
          .eq('id', p.id);
        if (error) throw error;
      }else{
        const { error } = await this.supabase.client
          .from('water_presets')
          .insert({ user_id: this.uid(), name: p.name, amount_ml: p.amount_ml, icon: p.icon, sort_order: 99 });
        if (error) throw error;
      }
      await this.loadPresetsOrSeed();
      this.closePresetModal();
    }catch(e:any){
      this.err.set(e?.message ?? 'No se pudo guardar el preset.');
      setTimeout(()=>this.err.set(null), 2200);
    }
  }

  deletePreset = async (p: Preset) => {
    if (!p.id) return;
    try{
      const { error } = await this.supabase.client.from('water_presets').delete().eq('id', p.id);
      if (error) throw error;
      await this.loadPresetsOrSeed();
    }catch(e:any){
      this.err.set(e?.message ?? 'No se pudo eliminar el preset.');
      setTimeout(()=>this.err.set(null), 2200);
    }
  };

  // Helpers para template
  iconFor(p: Preset){ return (p.icon ?? 'bottle') === 'cup' ? this.CupSodaIcon : this.DropletsIcon; }
  pctFor(d: DayItem){
    const g = this.goal() || 1;
    const pct = (d.total / g) * 100;
    return Math.max(0, Math.min(100, +pct.toFixed(1)));
  }
  levelForDay(d: DayItem){ return this.levelFor(d.total, this.goal()); }

  trackById = (_: number, e: Intake) => e.id;
  timeLabel = (it: Intake) => this.timeOf(it.logged_at);
}
