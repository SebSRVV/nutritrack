import {
  ChangeDetectionStrategy, Component, computed, inject, signal,
  AfterViewInit, OnDestroy, PLATFORM_ID
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  UtensilsCrossedIcon, PlusIcon, Trash2Icon, FlameIcon, ClockIcon, AppleIcon, SettingsIcon
} from 'lucide-angular';
import { SupabaseService } from '../../core/supabase.service';
import { environment } from '../../../environments/environment';

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
  ai_items?: any | null;
};

type AnalysisItem = { name: string; qty: number; unit?: string; kcal: number; categories: MealCategory[] };
type Analysis = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meal_type: MealType;
  meal_categories: MealCategory[];
  items: AnalysisItem[];
};

@Component({
  standalone: true,
  selector: 'nt-alimentation',
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './alimentation.page.html',
  styleUrls: ['./alimentation.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class AlimentationPage implements AfterViewInit, OnDestroy {
  // Icons
  readonly UtensilsCrossedIcon = UtensilsCrossedIcon;
  readonly PlusIcon = PlusIcon;
  readonly Trash2Icon = Trash2Icon;
  readonly FlameIcon = FlameIcon;
  readonly ClockIcon = ClockIcon;
  readonly AppleIcon = AppleIcon;
  readonly SettingsIcon = SettingsIcon;

  private supabase = inject(SupabaseService);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

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

  // Imagen / Uploader UX
  uploading = signal(false);
  imgPath = signal<string | null>(null);        // ruta en Storage
  imgPublicUrl = signal<string | null>(null);   // URL pública para OpenAI

  maxMB = 8;
  allowed = ['image/png','image/jpeg','image/webp','image/gif'];
  dzDrag = signal(false);                 // estado de drag-over
  previewUrl = signal<string|null>(null); // Object URL para preview inmediata
  previewName = signal<string>('');       // nombre mostrado
  previewSize = signal<string>('');       // tamaño amigable
  uploadPct = signal<number>(0);          // progreso (simulado)

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

  ngAfterViewInit() {
    // Evitar ReferenceError en SSR
    if (this.isBrowser) {
      window.addEventListener('paste', this.onPaste);
    }
  }

  ngOnDestroy() {
    if (this.isBrowser) {
      window.removeEventListener('paste', this.onPaste);
    }
    this.revokePreview();
  }

  private onPaste = async (e: ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) await this.handleFile(file);
  };

  private startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
  private endOfToday()   { const d = this.startOfToday(); d.setDate(d.getDate()+1); return d; }

  async loadToday() {
    const { data, error } = await this.supabase.client
      .from('meal_logs')
      .select('id, description, calories, protein_g, carbs_g, fat_g, meal_type, logged_at, meal_categories, ai_items')
      .eq('user_id', this.uid())
      .gte('logged_at', this.startOfToday().toISOString())
      .lt('logged_at', this.endOfToday().toISOString())
      .order('logged_at', { ascending: false });

    if (error) {
      this.err.set(error.message ?? 'No se pudo cargar el listado.');
      return;
    }

    this.todayLogs.set((data ?? []).map((r: any) => ({
      id: String(r.id),
      description: r.description,
      calories: Number(r.calories) || 0,
      protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
      meal_type: r.meal_type as MealType,
      logged_at: r.logged_at,
      meal_categories: r.meal_categories ?? null,
      ai_items: r.ai_items ?? null,
    })));
  }

  // ---- Helpers de error ----
  private stringifyBody(body: any): string | null {
    try {
      if (body == null) return null;
      if (typeof body === 'string') return body;
      const txt = JSON.stringify(body);
      return txt && txt !== '{}' ? txt : null;
    } catch { return null; }
  }

  private formatInvokeError(error: any, data: any): string {
    const status: number | undefined = error?.context?.status ?? error?.status;
    const bodyTxt = this.stringifyBody(error?.context?.body ?? data);
    let msg = `No se pudo analizar el texto/imagen (ai-analyze).`;
    if (typeof status === 'number') msg += ` status=${status}`;
    if (error?.message) msg += ` – ${error.message}`;
    if (bodyTxt) msg += ` – ${bodyTxt}`;
    return msg;
  }

  // --------- Storage helpers ---------
  private getPublicUrl(path: string) {
    const { data } = this.supabase.client.storage.from('meal_uploads').getPublicUrl(path);
    return data.publicUrl;
  }

  // ===== Uploader UX =====
  private revokePreview() {
    if (this.isBrowser && typeof URL !== 'undefined') {
      const u = this.previewUrl(); if (u) URL.revokeObjectURL(u);
    }
    this.previewUrl.set(null);
  }

  private formatBytes(n: number) {
    if (!Number.isFinite(n)) return '';
    const u = ['B','KB','MB','GB']; let i = 0;
    while (n >= 1024 && i < u.length-1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 10 || i===0 ? 0 : 1)} ${u[i]}`;
  }

  private validateFile(f: File) {
    if (!this.allowed.includes(f.type)) throw new Error('Formato no soportado. Usa PNG, JPG o WebP.');
    const limit = this.maxMB * 1024 * 1024;
    if (f.size > limit) throw new Error(`La imagen supera ${this.maxMB}MB.`);
  }

  async onFileInput(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await this.handleFile(file);
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dzDrag.set(true); }
  onDragLeave(e: DragEvent) { e.preventDefault(); this.dzDrag.set(false); }
  async onDrop(e: DragEvent) {
    e.preventDefault(); this.dzDrag.set(false);
    const f = e.dataTransfer?.files?.[0]; if (f) await this.handleFile(f);
  }

  private async handleFile(f: File) {
    if (!this.uid()) { this.analysisErr.set('Debes iniciar sesión.'); return; }
    try {
      this.validateFile(f);

      // Preview instantánea (sólo en navegador)
      this.revokePreview();
      if (this.isBrowser && typeof URL !== 'undefined') {
        const objUrl = URL.createObjectURL(f);
        this.previewUrl.set(objUrl);
      } else {
        this.previewUrl.set(null);
      }
      this.previewName.set(f.name);
      this.previewSize.set(this.formatBytes(f.size));

      // Subida a Storage
      this.uploading.set(true);
      this.analysisErr.set(null);
      this.uploadPct.set(15); // progreso visual optimista

      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
      const filePath = `u_${this.uid()}/${Date.now()}.${ext}`;

      const { error } = await this.supabase.client.storage.from('meal_uploads')
        .upload(filePath, f, { upsert: true, contentType: f.type || 'image/*' });
      if (error) throw error;

      this.uploadPct.set(80);

      this.imgPath.set(filePath);
      this.imgPublicUrl.set(this.getPublicUrl(filePath));

      this.uploadPct.set(100);
      setTimeout(() => this.uploadPct.set(0), 600);
    } catch (e: any) {
      this.analysisErr.set(e?.message ?? 'No se pudo subir la imagen.');
      this.removeImage(); // limpiar preview si falló
    } finally {
      this.uploading.set(false);
    }
  }

  viewImage() {
    if (!this.isBrowser) return;
    const u = this.imgPublicUrl(); if (u) window.open(u, '_blank');
  }

  removeImage() {
    this.imgPath.set(null);
    this.imgPublicUrl.set(null);
    this.previewName.set('');
    this.previewSize.set('');
    this.uploadPct.set(0);
    this.revokePreview();
  }

  // ---- API: analizar (Edge Function ai-analyze) ----
  private async analyzeWithAI(payload: { query?: string; image_url?: string; hint?: MealType }): Promise<Analysis> {
    const body = payload.image_url
      ? { mode: 'image', image_url: payload.image_url, hint_meal_type: payload.hint }
      : { mode: 'text',  query: payload.query ?? '',   hint_meal_type: payload.hint };

    const { data, error } = await this.supabase.client.functions.invoke('ai-analyze', {
      body,
      headers: { 'Content-Type': 'application/json' },
    });

    if (error) {
      try {
        const url = `${environment.supabaseUrl}/functions/v1/ai-analyze`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': environment.supabaseAnonKey, 'Authorization': `Bearer ${environment.supabaseAnonKey}` },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          throw new Error(`No se pudo analizar. status=${r.status} ${txt || ''}`);
        }
        const payload2 = await r.json();
        return this.normalizeAnalysis(payload2);
      } catch (e: any) {
        throw new Error(this.formatInvokeError(error, data) + (e?.message ? ` | ${e.message}` : ''));
      }
    }

    return this.normalizeAnalysis(data);
  }

  private normalizeAnalysis(a: any): Analysis {
    return {
      kcal: Number(a?.kcal) || 0,
      protein_g: Number(a?.protein_g) || 0,
      carbs_g: Number(a?.carbs_g) || 0,
      fat_g: Number(a?.fat_g) || 0,
      meal_type: (a?.meal_type ?? this.mealType()) as MealType,
      meal_categories: Array.isArray(a?.meal_categories) ? a.meal_categories : [],
      items: (a?.items ?? []).map((f: any) => ({
        name: String(f.name || ''),
        qty: Number(f.qty) || 0,
        unit: f.unit || undefined,
        kcal: Number(f.kcal) || 0,
        categories: Array.isArray(f.categories) ? f.categories : [],
      })),
    };
  }

  async analyze() {
    this.analysis.set(null);
    this.analysisErr.set(null);
    const q = this.text().trim();
    const img = this.imgPublicUrl();

    if (!q && !img) return;

    try {
      this.analyzing.set(true);
      const a = await this.analyzeWithAI({
        query: q || undefined,
        image_url: img || undefined,
        hint: this.mealType(),
      });

      // Forzar tipo igual a la pestaña seleccionada
      a.meal_type = this.mealType();

      this.analysis.set(a);
    } catch (e: any) {
      this.analysisErr.set(e?.message ?? 'No se pudo analizar.');
    } finally {
      this.analyzing.set(false);
    }
  }

  // ---- Persistencia ----
  private async addLog(payload: {
    description: string; calories: number;
    protein_g: number | null; carbs_g: number | null; fat_g: number | null;
    meal_type: MealType;
    meal_categories?: MealCategory[] | null;
    ai_items?: any | null;
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
      meal_categories: payload.meal_categories ?? null,
      ai_items: payload.ai_items ?? null,
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
      description: this.text().trim() || (this.imgPath() ? `Imagen: ${this.imgPath()}` : 'Registro'),
      calories: a.kcal, protein_g: a.protein_g, carbs_g: a.carbs_g, fat_g: a.fat_g,
      meal_type: this.mealType(),
      meal_categories: a.meal_categories,
      ai_items: a.items,
    });
    // limpiar inputs
    this.text.set(''); this.analysis.set(null); this.removeImage();
  }

  async addManual(calories: number) {
    calories = Math.max(0, Math.round(calories));
    if (!calories || !(this.text().trim())) return;
    await this.addLog({
      description: this.text().trim(),
      calories, protein_g: null, carbs_g: null, fat_g: null,
      meal_type: this.mealType(),
    });
    this.text.set(''); this.analysis.set(null);
  }

  /** Prompt seguro (solo en cliente) para ingresar kcal manualmente */
  openManualPrompt() {
    if (!this.isBrowser) return; // SSR safe
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

  groupList(k: MealType) { return this.grouped()[k]; }
  totalFor(k: MealType)  { return this.groupList(k).reduce((s, x) => s + (x.calories || 0), 0); }

  fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }
}
