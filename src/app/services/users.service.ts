import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

export interface UserProfile { id: string; email: string; /* ... */ }

@Injectable({ providedIn: 'root' })
export class UsersService {
  private base = environment.apiBaseUrl; // p.ej., https://<render>.onrender.com

  constructor(private http: HttpClient) {}

  getMe(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.base}/api/users/me`);
  }
}
