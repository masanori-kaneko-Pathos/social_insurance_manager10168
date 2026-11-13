import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { employeeGuard, staffGuard } from './core/auth/role.guard';
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

  // ===== 招待（ログイン前でも開く。画面の中でログインの状態を見る） =====
  {
    path: 'invite/:officeId/:code',
    loadComponent: () =>
      import('./features/invites/pages/invite-accept/invite-accept').then((m) => m.InviteAccept),
  },

  // ===== 事業所のメンバー（管理者・一般）への招待。メールの確認待ちの人を追い出さないよう、ガードの外 =====
  {
    path: 'join/:officeId/:code',
    loadComponent: () => import('./features/invites/pages/join/join').then((m) => m.JoinPage),
  },

  // ===== ログイン後（親で authGuard を1回だけ） =====
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [startGuard], children: [] },
      // ----- 従業員のマイページ -----
      {
        path: 'me',
        canActivate: [employeeGuard],
        children: [
          {
            path: '',
            loadComponent: () => import('./features/me/pages/my-page/my-page').then((m) => m.MyPage),
          },
          {
            path: 'requests/:requestId',
            loadComponent: () =>
              import('./features/me/pages/my-request/my-request').then((m) => m.MyRequest),
          },
          {
            path: 'change',
            loadComponent: () =>
              import('./features/me/pages/my-change/my-change').then((m) => m.MyChange),
          },
          {
            path: 'account',
            loadComponent: () =>
              import('./features/account/pages/my-account/my-account').then((m) => m.MyAccountPage),
          },
        ],
      },
      // 事業所がまだない管理者のホーム（新規登録の直後はここ。11/12）
      {
        path: 'start',
        canActivate: [staffGuard],
        loadComponent: () => import('./features/office/pages/welcome/welcome').then((m) => m.Welcome),
      },
      // 事業所がまだない管理者のアカウントの設定（パスワード・メールアドレスの変更。11/13）
      {
        path: 'start/account',
        canActivate: [staffGuard],
        loadComponent: () => import('./features/office/pages/welcome/welcome-account').then((m) => m.WelcomeAccount),
      },
      {
        path: 'offices/new',
        canActivate: [staffGuard],
        loadComponent: () =>
          import('./features/office/pages/office-form/office-form').then((m) => m.OfficeForm),
      },
      {
        path: 'o/:officeId',
        canActivate: [staffGuard, officeGuard],
        loadComponent: () =>
          import('./features/office/pages/office-shell/office-shell').then((m) => m.OfficeShell),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/dashboard/pages/dashboard/dashboard').then((m) => m.Dashboard),
          },
          {
            path: 'ages',
            loadComponent: () =>
              import('./features/dashboard/pages/age-list/age-list').then((m) => m.AgeList),
          },
          {
            path: 'employees',
            loadComponent: () =>
              import('./features/employees/pages/employee-list/employee-list').then(
                (m) => m.EmployeeList,
              ),
          },
          {
            path: 'employees/import',
            loadComponent: () =>
              import('./features/employees/pages/employee-import/employee-import').then(
                (m) => m.EmployeeImport,
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
            path: 'calendar',
            loadComponent: () =>
              import('./features/calendar/pages/calendar/calendar').then((m) => m.CalendarPage),
          },
          {
            path: 'filings',
            loadComponent: () =>
              import('./features/filings/pages/filings/filings').then((m) => m.FilingsPage),
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
            path: 'requests',
            loadComponent: () =>
              import('./features/requests/pages/request-list/request-list').then((m) => m.RequestList),
          },
          {
            path: 'requests/new',
            loadComponent: () =>
              import('./features/requests/pages/request-new/request-new').then((m) => m.RequestNew),
          },
          {
            path: 'requests/:requestId',
            loadComponent: () =>
              import('./features/requests/pages/request-review/request-review').then((m) => m.RequestReview),
          },
          {
            path: 'help',
            loadComponent: () => import('./features/help/pages/help/help').then((m) => m.HelpPage),
          },
          {
            path: 'account',
            loadComponent: () => import('./features/account/pages/account/account').then((m) => m.AccountPage),
          },
          {
            path: 'members',
            loadComponent: () =>
              import('./features/members/pages/members/members').then((m) => m.MembersPage),
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
