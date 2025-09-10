import { ChangeDetectionStrategy, Component, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { LucideAngularModule, ArrowLeftIcon, MailIcon, LockIcon } from 'lucide-angular';
import { trigger, transition, style, animate, query, stagger, group } from '@angular/animations';

@Component({
  standalone: true,
  selector: 'nt-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        // Estados iniciales
        style({ opacity: 0, transform: 'translateY(16px)' }),
        query('.card', style({ opacity: 0, transform: 'translateY(12px) scale(.98)' }), { optional: true }),
        // Animar en paralelo para evitar re-layouts intermedios
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
export default class LoginPage {
  readonly ArrowLeftIcon = ArrowLeftIcon;
  readonly MailIcon = MailIcon;
  readonly LockIcon = LockIcon;

  private fb = inject(NonNullableFormBuilder);
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  // Flag: solo montamos el host animado cuando el cliente esté listo
  animReady = signal(false);

  submitting = signal(false);
  serverError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  form = this.fb.group({
    email: this.fb.control('', { validators: [Validators.required, Validators.email] }),
    password: this.fb.control('', { validators: [Validators.required, Validators.minLength(6)] }),
  });

  constructor() {
    // Si es browser, espera a que Angular quede estable y habilita animaciones
    if (isPlatformBrowser(this.platformId)) {
      // Un microtick + rAF asegura que ya se aplicó hidratación
      queueMicrotask(() => {
        requestAnimationFrame(() => this.animReady.set(true));
      });
    }
  }

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
      const { error } = await this.supabase.client.auth.signInWithPassword({ email: v.email, password: v.password });
      if (error) throw error;

      this.successMessage.set('Inicio de sesión exitoso, redirigiendo…');
      setTimeout(() => this.router.navigateByUrl('/profile'), 1200);

    } catch (e: any) {
      const msg = e?.message ?? 'Error al iniciar sesión.';
      this.serverError.set(/Invalid login credentials/i.test(msg) ? 'Credenciales inválidas.' : msg);
    } finally {
      this.submitting.set(false);
    }
  }
}
