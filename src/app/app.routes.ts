import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { guestGuard } from './core/auth/guest.guard';
import { officeGuard } from './features/office/office.guard';
import { startGuard } from './features/office/start.guard';

export const routes: Routes = [
  // ===== ログイン前 =====
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/pages/login/login').then((m) => m.Login),
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/pages/signup/signup').then((m) => m.Signup),
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/pages/forgot-password/forgot-password').then((m) => m.ForgotPassword),
  },

  // ===== ログイン後（親で authGuard を1回だけ） =====
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [startGuard], children: [] },
      {
        path: 'offices/new',
        loadComponent: () =>
          import('./features/office/pages/office-form/office-form').then((m) => m.OfficeForm),
      },
      {
        path: 'o/:officeId',
        canActivate: [officeGuard],
        loadComponent: () =>
          import('./features/office/pages/office-shell/office-shell').then((m) => m.OfficeShell),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/dashboard/pages/dashboard/dashboard').then((m) => m.Dashboard),
          },
        ],
      },
    ],
  },

  { path: '**', redirectTo: '' },
];