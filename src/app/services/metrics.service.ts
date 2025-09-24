// src/app/services/metrics.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MetricsResponse {
  bmi: number | null;
  bmiStatus: 'Bajo peso' | 'Saludable' | 'Sobrepeso' | 'Obesidad' | null;
  age: number | null;
  daysUntilBirthday: number | null;
}

// Envelope real del backend
interface BackendEnvelope {
  ok?: boolean;
  status?: number;
  timestamp?: string;
  data?: {
    // lo que vimos en tu log:
    bmi?: number | null;
    age?: number | null;
    daysToBirthday?: number | null;
    // por si algún día lo envían:
    bmiStatus?: string | null;
    bmi_status?: string | null;
  };
}

// logs opcionales
const DEBUG = true;
const dlog = (...a: any[]) => DEBUG && console.log('[MetricsService]', ...a);

@Injectable({ providedIn: 'root' })
export class MetricsService {
  private http = inject(HttpClient);

  getMetrics(dob: string, height_cm: number, weight_kg: number): Observable<MetricsResponse> {
    const params = new HttpParams()
      .set('dob', dob)
      .set('height_cm', String(height_cm))
      .set('weight_kg', String(weight_kg));

    const base = environment?.apiBaseUrl ?? '';
    const url = `${base}/api/metrics`;

    dlog('➡️ GET', url, { params: { dob, height_cm, weight_kg } });

    return this.http.get<BackendEnvelope>(url, { params }).pipe(
      tap(raw => dlog('✅ 200 OK (raw backend):', raw)),
      map((raw) => {
        const d = raw?.data ?? {};
        const bmi = (typeof d.bmi === 'number') ? d.bmi : null;
        const age = (typeof d.age === 'number') ? d.age : null;
        const daysToBirthday = (typeof d.daysToBirthday === 'number') ? d.daysToBirthday : null;

        // preferimos el estado que venga del backend si existe
        let status = (d.bmiStatus ?? d.bmi_status) as MetricsResponse['bmiStatus'] | undefined | null;

        // si no viene, lo calculamos nosotros
        if (!status && typeof bmi === 'number') {
          if (bmi < 18.5) status = 'Bajo peso';
          else if (bmi < 25) status = 'Saludable';
          else if (bmi < 30) status = 'Sobrepeso';
          else status = 'Obesidad';
        }

        const mapped: MetricsResponse = {
          bmi,
          bmiStatus: status ?? null,
          age,
          daysUntilBirthday: daysToBirthday,
        };

        dlog('🔁 mapped → MetricsResponse:', mapped);
        return mapped;
      }),
      catchError((err) => {
        dlog('❌ ERROR:', err?.status, err?.message || err);
        if (err?.error) dlog('❌ error.error:', err.error);
        return throwError(() => err);
      })
    );
  }
}
