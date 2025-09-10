import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.page') },   // Home
  // deja preparadas rutas para tus botones:
  { path: 'reports', loadComponent: () => import('./pages/reports/reports.page') },
  { path: 'log',      loadComponent: () => import('./pages/log/log.page') },
  { path: 'goals',    loadComponent: () => import('./pages/goals/goals.page') },
  { path: 'register', loadComponent: () => import('./pages/register/register.page') },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page'),
    data: { animation: 'login' }
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile.page').then(m => m.default),
    canActivate: [authGuard]
  },
  { path: '**', redirectTo: '' },
];
