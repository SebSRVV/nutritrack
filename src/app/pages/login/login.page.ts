import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import {
  LucideAngularModule,
  ArrowLeftIcon, MailIcon, LockIcon
} from 'lucide-angular';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

@Component({
  standalone: true,
  selector: 'nt-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.css'], // puedes reusar register.page.css
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('page', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(16px)' }),
        animate('420ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' })),
        query('.card', [
          style({ opacity: 0, transform: 'translateY(12px) scale(.98)' }),
          stagger(80, animate('380ms cubic-bezier(.16,1,.3,1)', style({ opacity: 1, transform: 'none' })))
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

  submitting = signal(false);
  serverError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  form = this.fb.group({
    email: this.fb.control('', { validators: [Validators.required, Validators.email] }),
    password: this.fb.control('', { validators: [Validators.required, Validators.minLength(6)] }),
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
      const { error } = await this.supabase.client.auth.signInWithPassword({
        email: v.email,
        password: v.password
      });
      if (error) throw error;

      this.successMessage.set('Inicio de sesión exitoso, redirigiendo…');
      setTimeout(() => this.router.navigateByUrl('/dashboard'), 1500);

    } catch (e: any) {
      this.serverError.set(e?.message ?? 'Error al iniciar sesión.');
    } finally {
      this.submitting.set(false);
    }
  }
}
