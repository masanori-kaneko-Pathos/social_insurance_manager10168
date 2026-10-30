import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { guestGuard } from './core/auth/guest.guard';

export const routes: Routes = [
    {
      path: 'login',
      canActivate: [guestGuard],
      loadComponent: () =>
        import('./features/auth/pages/login/login').then((m) => m.Login),
    },
    {
      path: 'signup',
      canActivate: [guestGuard],
      loadComponent: () =>
        import('./features/auth/pages/signup/signup').then((m) => m.Signup),
    },
    {
      path: 'forgot-password',
      canActivate: [guestGuard],
      loadComponent: () =>
        import('./features/auth/pages/forgot-password/forgot-password').then((m) => m.ForgotPassword),
    },
    {
      path: 'home',
      canActivate: [authGuard],
      loadComponent: () =>
        import('./features/home/pages/home/home').then((m) => m.Home),
    },
    { path: '', pathMatch: 'full', redirectTo: 'home' },
    { path: '**', redirectTo: 'home' },
  ];
