import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  UserIcon, MailIcon, CalendarIcon, RulerIcon, ScaleIcon, HeartPulseIcon,
  LogOutIcon, SaveIcon, InfoIcon, Trash2Icon, ShieldAlertIcon, IdCardIcon, ActivityIcon
} from 'lucide-angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type Sex = 'female' | 'male';
type ActivityLevel = 'sedentary' | 'moderate' | 'very_active';
type DietType = 'low_carb' | 'caloric_deficit' | 'surplus';

type UserMeta = {
  username?: string;
  dob?: string;
  sex?: Sex;
  height_cm?: number;
  weight_kg?: number;
  bmi?: number;
  activity_level?: ActivityLevel;
  diet_type?: DietType;
};

function calcAge(dobStr?: string): number | null {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return Math.max(age, 0);
}
function daysUntilBirthday(dobStr?: string): number | null {
  if (!dobStr) return null;
  const today = new Date();
  const dob = new Date(dobStr);
  const thisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  const next = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

@Component({
  standalone: true,
  selector: 'nt-profile',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export default class ProfilePage {
  Math = Math;

  // Icons
  readonly UserIcon = UserIcon;
  readonly MailIcon = MailIcon;
  readonly CalendarIcon = CalendarIcon;
  readonly RulerIcon = RulerIcon;
  readonly ScaleIcon = ScaleIcon;
  readonly HeartPulseIcon = HeartPulseIcon;
  readonly LogOutIcon = LogOutIcon;
  readonly SaveIcon = SaveIcon;
  readonly InfoIcon = InfoIcon;
  readonly Trash2Icon = Trash2Icon;
  readonly ShieldAlertIcon = ShieldAlertIcon;
  readonly IdCardIcon = IdCardIcon;
  readonly ActivityIcon = ActivityIcon;

  private fb = inject(NonNullableFormBuilder);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  loading = signal(true);
  saving  = signal(false);
  deleting = signal(false);
  serverError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  email   = signal<string>('');
  userId  = signal<string>('');
  createdAt = signal<string>('');
  lastSignInAt = signal<string>('');
  username = signal<string>('');
  sex = signal<Sex>('female');
  dob  = signal<string>('');

  activityLevel = signal<ActivityLevel>('sedentary');
  dietType = signal<DietType>('caloric_deficit');

  form = this.fb.group({
    height_cm: this.fb.control(170, { validators: [Validators.required, Validators.min(80), Validators.max(230)] }),
    weight_kg: this.fb.control(70,  { validators: [Validators.required, Validators.min(25), Validators.max(250)] }),
  });

  private hCtrl = this.form.controls.height_cm;
  private wCtrl = this.form.controls.weight_kg;

  heightVal = signal<number>(this.hCtrl.value);
  weightVal = signal<number>(this.wCtrl.value);

  age = computed(() => calcAge(this.dob() || undefined));
  daysToBday = computed(() => daysUntilBirthday(this.dob() || undefined));
  heightPct = computed(() => Math.round(((this.heightVal() - 80) / (230 - 80)) * 100));
  weightPct = computed(() => Math.round(((this.weightVal() - 25) / (250 - 25)) * 100));

  bmi = computed(() => {
    const h = this.heightVal();
    const w = this.weightVal();
    if (!h || !w) return null;
    const meters = h / 100;
    return +(w / (meters * meters)).toFixed(1);
  });
  bmiStatus = computed(() => {
    const v = this.bmi();
    if (v === null) return { label: '—', color: 'muted' as const };
    if (v < 18.5)  return { label: 'Bajo peso',   color: 'amber' as const };
    if (v < 25)    return { label: 'Saludable',   color: 'green' as const };
    if (v < 30)    return { label: 'Sobrepeso',   color: 'cyan'  as const };
    return { label: 'Obesidad', color: 'violet' as const };
  });

  showDeleteModal = signal(false);
  confirmText = signal('');

  constructor() {
    this.hCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.heightVal.set(v));
    this.wCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.weightVal.set(v));

    effect(() => {
      const h = this.heightVal();
      if (h < 80) this.hCtrl.setValue(80, { emitEvent: false });
      if (h > 230) this.hCtrl.setValue(230, { emitEvent: false });
      const w = this.weightVal();
      if (w < 25) this.wCtrl.setValue(25, { emitEvent: false });
      if (w > 250) this.wCtrl.setValue(250, { emitEvent: false });
    });

    this.init();
  }

  private async init() {
    try {
      this.loading.set(true);
      const { data: { user }, error } = await this.supabase.client.auth.getUser();
      if (error) throw error;
      if (!user) {
        await this.router.navigate(['/login'], { queryParams: { auth: 'required', redirect: '/profile' } });
        return;
      }
      this.userId.set(user.id);
      this.email.set(user.email ?? '');
      this.createdAt.set(user.created_at ?? '');
      this.lastSignInAt.set((user.last_sign_in_at as string) ?? '');

      const md = (user.user_metadata ?? {}) as UserMeta;
      this.username.set(md.username ?? '');
      this.sex.set((md.sex ?? 'female') as Sex);
      this.dob.set(md.dob ?? '');
      this.activityLevel.set((md.activity_level ?? 'sedentary') as ActivityLevel);
      this.dietType.set((md.diet_type ?? 'caloric_deficit') as DietType);

      this.form.patchValue({
        height_cm: Number(md.height_cm ?? 170),
        weight_kg: Number(md.weight_kg ?? 70),
      }, { emitEvent: true });

      this.heightVal.set(this.form.controls.height_cm.value);
      this.weightVal.set(this.form.controls.weight_kg.value);
    } catch (e: any) {
      this.serverError.set(e?.message ?? 'No se pudo cargar tu perfil.');
    } finally {
      this.loading.set(false);
    }
  }

  setActivity(v: ActivityLevel){ this.activityLevel.set(v); }
  setDiet(v: DietType){ this.dietType.set(v); }

  async save() {
    this.serverError.set(null);
    this.successMessage.set(null);
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    const v = this.form.getRawValue();
    try {
      const { error } = await this.supabase.client.auth.updateUser({
        data: {
          username:  this.username(),
          dob:       this.dob(),
          sex:       this.sex(),
          height_cm: v.height_cm,
          weight_kg: v.weight_kg,
          bmi: this.bmi() ?? undefined,
          activity_level: this.activityLevel(),
          diet_type: this.dietType(),
        }
      });
      if (error) throw error;
      this.successMessage.set('Cambios guardados correctamente.');
    } catch (e: any) {
      this.serverError.set(e?.message ?? 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  openDeleteModal() { this.confirmText.set(''); this.showDeleteModal.set(true); this.serverError.set(null); this.successMessage.set(null); }
  closeDeleteModal() { this.showDeleteModal.set(false); }

  async deleteAccount() {
    if (this.confirmText().toLowerCase() !== 'eliminar') return;
    this.deleting.set(true);
    this.serverError.set(null);
    try {
      const { error } = await this.supabase.client.functions.invoke('delete-user', { body: { userId: this.userId() } });
      if (error) throw error;
      await this.supabase.client.auth.signOut();
      await this.router.navigateByUrl('/login');
    } catch (e: any) {
      this.serverError.set(e?.message ?? 'No se pudo eliminar la cuenta. Verifica la Edge Function "delete-user".');
    } finally {
      this.deleting.set(false);
      this.showDeleteModal.set(false);
    }
  }

  async logout() {
    await this.supabase.client.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
