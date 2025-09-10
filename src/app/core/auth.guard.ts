import { Injectable, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class _Auth {
  supabase = inject(SupabaseService);
  router = inject(Router);
  async can(): Promise<boolean> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (user) return true;
    await this.router.navigate(['/login'], { queryParams: { auth: 'required', redirect: '/profile' } });
    return false;
  }
}

// Angular standalone guard function
export const authGuard: CanActivateFn = async () => {
  const g = new _Auth();
  return g.can();
};
