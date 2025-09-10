// src/app/core/supabase.service.ts
import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private _client!: SupabaseClient;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    // SSR-safe: solo inicializa features que usan storage en el browser
    this._client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        autoRefreshToken: isPlatformBrowser(platformId),
        persistSession: isPlatformBrowser(platformId),
        detectSessionInUrl: isPlatformBrowser(platformId),
      },
    });
  }

  get client() {
    return this._client;
  }
}
