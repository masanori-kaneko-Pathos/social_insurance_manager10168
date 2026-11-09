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
          {
            path: 'employees',
            loadComponent: () =>
              import('./features/employees/pages/employee-list/employee-list').then(
                (m) => m.EmployeeList,
              ),
          },
          {
            path: 'employees/new',
            loadComponent: () =>
              import('./features/employees/pages/employee-form/employee-form').then(
                (m) => m.EmployeeForm,
              ),
          },
          {
            path: 'employees/:employeeId',
            loadComponent: () =>
              import('./features/employees/pages/employee-detail/employee-detail').then(
                (m) => m.EmployeeDetail,
              ),
          },
          {
            path: 'employees/:employeeId/edit',
            loadComponent: () =>
              import('./features/employees/pages/employee-form/employee-form').then(
                (m) => m.EmployeeForm,
              ),
          },
          {
            path: 'premiums',
            loadComponent: () =>
              import('./features/premiums/pages/premium-list/premium-list').then(
                (m) => m.PremiumList,
              ),
          },
          {
            path: 'bonuses',
            loadComponent: () =>
              import('./features/premiums/pages/bonus-list/bonus-list').then((m) => m.BonusList),
          },
          {
            path: 'bonuses/new',
            loadComponent: () =>
              import('./features/premiums/pages/bonus-form/bonus-form').then((m) => m.BonusForm),
          },
          {
            path: 'bonuses/:bonusId',
            loadComponent: () =>
              import('./features/premiums/pages/bonus-form/bonus-form').then((m) => m.BonusForm),
          },
          {
            path: 'payrolls',
            loadComponent: () =>
              import('./features/payrolls/pages/payroll-list/payroll-list').then(
                (m) => m.PayrollList,
              ),
          },
          {
            path: 'payrolls/import',
            loadComponent: () =>
              import('./features/payrolls/pages/payroll-import/payroll-import').then(
                (m) => m.PayrollImport,
              ),
          },
          {
            path: 'payrolls/:month',
            loadComponent: () =>
              import('./features/payrolls/pages/payroll-month/payroll-month').then(
                (m) => m.PayrollMonth,
              ),
          },
          {
            path: 'regular/:year',
            loadComponent: () =>
              import('./features/payrolls/pages/regular/regular').then((m) => m.RegularPage),
          },
          {
            path: 'revisions',
            loadComponent: () =>
              import('./features/payrolls/pages/revisions/revisions').then((m) => m.RevisionsPage),
          },
          {
            path: 'settings',
            data: { mode: 'edit' },
            loadComponent: () =>
              import('./features/office/pages/office-form/office-form').then((m) => m.OfficeForm),
          },
        ],
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
