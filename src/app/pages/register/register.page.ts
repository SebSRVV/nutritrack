import { ChangeDetectionStrategy, Component, computed, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  ArrowLeftIcon, UserIcon, MailIcon, LockIcon, CalendarIcon,
  RulerIcon, ScaleIcon, HeartPulseIcon, InfoIcon
} from 'lucide-angular';
import { trigger, transition, style, animate, query, stagger, group } from '@angular/animations';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService, RegisterRequest } from '../../services/auth.service';
import { firstValueFrom, combineLatest, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, map, startWith } from 'rxjs/operators';
import { MetricsService, MetricsResponse } from '../../services/metrics.service';

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
        style({ opacity: 0, transform: 'translateY(16px)' }),
        query('.card', style({ opacity: 0, transform: 'translateY(12px) scale(.98)' }), { optional: true }),
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
  private router = inject(Router);
  private auth = inject(AuthService);
  private metrics = inject(MetricsService);

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

  private readonly MIN_H = 80;
  private readonly MAX_H = 230;
  private readonly MIN_W = 25;
  private readonly MAX_W = 250;

  private hCtrl = this.form.controls.height_cm;
  private wCtrl = this.form.controls.weight_kg;
  private dobCtrl = this.form.controls.dob;

  // Signals para sliders (UI inmediata)
  heightVal = signal<number>(this.hCtrl.value);
  weightVal = signal<number>(this.wCtrl.value);
  dobVal    = signal<string>(this.dobCtrl.value);

  // Signals del BACKEND
  metricsLoading = signal(false);
  metricsError   = signal<string | null>(null);
  metricsData    = signal<MetricsResponse | null>(null);

  // Porcentaje de sliders (UI-only)
  heightPct = computed(() =>
    Math.round(((this.heightVal() - this.MIN_H) / (this.MAX_H - this.MIN_H)) * 100)
  );
  weightPct = computed(() =>
    Math.round(((this.weightVal() - this.MIN_W) / (this.MAX_W - this.MIN_W)) * 100)
  );

  constructor() {
    // Sincronizamos cambios de form a signals
    this.hCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.heightVal.set(v));
    this.wCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.weightVal.set(v));
    this.dobCtrl.valueChanges.pipe(takeUntilDestroyed()).subscribe(v => this.dobVal.set(v));

    // Cada vez que cambian (dob, height, weight) -> backend
    combineLatest([
      this.dobCtrl.valueChanges.pipe(startWith(this.dobCtrl.value)),
      this.hCtrl.valueChanges.pipe(startWith(this.hCtrl.value)),
      this.wCtrl.valueChanges.pipe(startWith(this.wCtrl.value)),
    ])
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(([dob, height, weight]) => {
          if (!dob || !height || !weight) {
            this.metricsData.set(null);
            return of(null);
          }
          this.metricsError.set(null);
          this.metricsLoading.set(true);
          return this.metrics.getMetrics(dob, height, weight).pipe(
            map(res => {
              this.metricsLoading.set(false);
              this.metricsData.set(res);
              return res;
            }),
            catchError((err) => {
              this.metricsLoading.set(false);
              const msg = err?.error?.message || err?.message || 'No se pudieron calcular las métricas.';
              this.metricsError.set(msg);
              this.metricsData.set(null);
              return of(null);
            })
          );
        }),
        takeUntilDestroyed()
      ).subscribe();
  }

  // Utils de clamp + redondeo a entero
  private clampInt(v: number, min: number, max: number) {
    const n = Number.isFinite(v) ? Math.round(v) : min;
    return Math.min(max, Math.max(min, n));
  }

  // Setters usados por los sliders
  setHeight(v: number) {
    const n = this.clampInt(v, this.MIN_H, this.MAX_H);
    this.hCtrl.setValue(n);
  }

  setWeight(v: number) {
    const n = this.clampInt(v, this.MIN_W, this.MAX_W);
    this.wCtrl.setValue(n);
  }

  // Clamp de seguridad por si algo externo empuja fuera de rango
  private clampEffect = effect(() => {
    queueMicrotask(() => {
      const h = this.heightVal();
      if (h < this.MIN_H) this.hCtrl.setValue(this.MIN_H, { emitEvent: false });
      else if (h > this.MAX_H) this.hCtrl.setValue(this.MAX_H, { emitEvent: false });

      const w = this.weightVal();
      if (w < this.MIN_W) this.wCtrl.setValue(this.MIN_W, { emitEvent: false });
      else if (w > this.MAX_W) this.wCtrl.setValue(this.MAX_W, { emitEvent: false });
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

    const dto: RegisterRequest = {
      username: v.username,
      email: v.email,
      password: v.password,
      dob: v.dob,
      sex: v.sex,
      height_cm: v.height_cm,
      weight_kg: v.weight_kg
    };

    try {
      const res = await firstValueFrom(this.auth.register(dto));
      this.successMessage.set(res?.message ?? 'Registro exitoso. ¡Ahora inicia sesión!');
      setTimeout(() => this.router.navigateByUrl('/login'), 2000);
    } catch (e: any) {
      const msg = e?.error?.message || e?.message || 'Error al registrar.';
      this.serverError.set(msg);
    } finally {
      this.submitting.set(false);
    }
  }
}
