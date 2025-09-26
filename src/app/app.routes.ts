import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home.page') },   // Home
  // deja preparadas rutas para tus botones:
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
  { path: 'dashboard',     loadComponent: () => import('./pages/dashboard/dashboard.page') },
  { path: 'goals', loadComponent: () => import('./pages/goals/goals.page').then(m => m.GoalsPage) },
  // { path: 'goals/:id', loadComponent: () => import('./pages/goals/detail.page').then(m => m.GoalDetailPage) },
  { path: 'alimentation',  loadComponent: () => import('./pages/alimentation/alimentation.page') },
  { path: 'water',         loadComponent: () => import('./pages/water/water.page') },
  { path:'panel', loadComponent: () => import('./pages/panel/panel.page') },

  { path: '**', redirectTo: '' },
];
