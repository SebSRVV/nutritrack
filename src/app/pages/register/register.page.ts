import { ChangeDetectionStrategy, Component, computed, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  ArrowLeftIcon, UserIcon, MailIcon, LockIcon, CalendarIcon,
  RulerIcon, ScaleIcon, HeartPulseIcon, InfoIcon
} from 'lucide-angular';
import { trigger, transition, style, animate, query, stagger, group } from '@angular/animations';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
type Sex = 'female' | 'male';

@Component({
  standalone: true,
  selector: 'nt-register',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        // estado inicial
        style({ opacity: 0, transform: 'translateY(16px)' }),
        query('.card', style({ opacity: 0, transform: 'translateY(12px) scale(.98)' }), { optional: true }),
        // animar en paralelo para evitar parpadeos por re-layout
        group([
          animate('420ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' })),
          query('.card', [
            stagger(80, animate('380ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' })))
          ], { optional: true })
        ])
      ])
    ])
  ]
})
export default class RegisterPage {
  // Icons
  readonly ArrowLeftIcon = ArrowLeftIcon;
  readonly UserIcon = UserIcon;
  readonly MailIcon = MailIcon;
  readonly LockIcon = LockIcon;
  readonly CalendarIcon = CalendarIcon;
  readonly RulerIcon = RulerIcon;
  readonly ScaleIcon = ScaleIcon;
  readonly HeartPulseIcon = HeartPulseIcon;
  readonly InfoIcon = InfoIcon;

  private fb = inject(NonNullableFormBuilder);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  submitting = signal(false);
  serverError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  form = this.fb.group({
    username: this.fb.control('', { validators: [Validators.required, Validators.minLength(3), Validators.maxLength(24)] }),
    email: this.fb.control('', { validators: [Validators.required, Validators.email] }),
    password: this.fb.control('', { validators: [Validators.required, Validators.minLength(6)] }),
    dob: this.fb.control('', { validators: [Validators.required] }),
    sex: this.fb.control<Sex>('female', { validators: [Validators.required] }),
    height_cm: this.fb.control(170, { validators: [Validators.required, Validators.min(80), Validators.max(230)] }),
    weight_kg: this.fb.control(70,  { validators: [Validators.required, Validators.min(25), Validators.max(250)] }),
  });

  private hCtrl = this.form.controls.height_cm;
  private wCtrl = this.form.controls.weight_kg;
  private dobCtrl = this.form.controls.dob;

  heightVal = signal<number>(this.hCtrl.value);
  weightVal = signal<number>(this.wCtrl.value);
  dobVal    = signal<string>(this.dobCtrl.value);

  constructor() {
    this.hCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.heightVal.set(v));
    this.wCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.weightVal.set(v));
    this.dobCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.dobVal.set(v));
  }

  // Computados
  age = computed(() => calcAge(this.dobVal() || undefined));
  daysToBday = computed(() => daysUntilBirthday(this.dobVal() || undefined));

  heightPct = computed(() => Math.round(((this.heightVal() - 80) / (230 - 80)) * 100));
  weightPct = computed(() => Math.round(((this.weightVal() - 25) / (250 - 25)) * 100));

  // BMI
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

  // Handlers para sincronizar slider <-> number <-> barra
  setHeight(v: number) { this.hCtrl.setValue(v); }
  setWeight(v: number) { this.wCtrl.setValue(v); }

  // Clamp con microtarea para evitar "rebote" visual
  private clampEffect = effect(() => {
    queueMicrotask(() => {
      const h = this.heightVal();
      if (h < 80) this.hCtrl.setValue(80, { emitEvent: false });
      else if (h > 230) this.hCtrl.setValue(230, { emitEvent: false });

      const w = this.weightVal();
      if (w < 25) this.wCtrl.setValue(25, { emitEvent: false });
      else if (w > 250) this.wCtrl.setValue(250, { emitEvent: false });
    });
  });

  async submit() {
    this.serverError.set(null);
    this.successMessage.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);

    const v = this.form.getRawValue();

    try {
      const { data, error } = await this.supabase.client.auth.signUp({
        email: v.email,
        password: v.password,
        options: {
          data: {
            username: v.username,
            dob: v.dob,
            sex: v.sex,
            height_cm: v.height_cm,
            weight_kg: v.weight_kg,
            bmi: this.bmi() ?? undefined,
          }
        }
      });
      if (error) throw error;

      // Mensaje + redirección diferida a login
      this.successMessage.set('Registro exitoso. Puedes iniciar sesión.');
      setTimeout(() => this.router.navigateByUrl('/login'), 3000);

    } catch (e: any) {
      this.serverError.set(e?.message ?? 'Error al registrar.');
    } finally {
      this.submitting.set(false);
    }
  }
}
