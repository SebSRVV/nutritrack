// src/app/core/auth.interceptor.ts
import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { SupabaseService } from './supabase.service';

function isBackend(url: string): boolean {
  // Soporta absolutas y relativas
  if (url.startsWith('/')) return true; // proxy /api en el mismo host
  return !!environment.apiBaseUrl && url.startsWith(environment.apiBaseUrl);
}

/** Rutas PÚBLICAS: jamás adjuntar Authorization */
const PUBLIC_PATHS = [
  '/api/auth/',
  '/api/metrics', // <-- tu endpoint público
];

function isPublicEndpoint(urlStr: string): boolean {
  const url = new URL(urlStr, window.location.origin);
  return PUBLIC_PATHS.some(p => url.pathname.startsWith(p));
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Solo toqueteamos llamadas a nuestro backend
  if (!isBackend(req.url)) return next(req);

  // Nunca adjuntes Authorization en endpoints públicos
  if (isPublicEndpoint(req.url)) {
    return next(req);
  }

  const supabase = inject(SupabaseService);

  return from(supabase.client.auth.getSession()).pipe(
    switchMap(({ data: { session } }) => {
      const token = session?.access_token;
      const authReq = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req; // si no hay token, deja pasar sin header

      return next(authReq);
    })
  );
};
