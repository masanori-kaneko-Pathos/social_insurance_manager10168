import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { employeeGuard, staffGuard } from './core/auth/role.guard';
import { guestGuard } from './core/auth/guest.guard';
import { officeGuard } from './features/office/office.guard';
import { startGuard } from './features/office/start.guard';
import { withUnsavedGuard } from './shared/services/unsaved-changes';

// 画面を持つルートすべてに「保存していない入力があれば確かめる」を付ける（11/17）
export const routes: Routes = withUnsavedGuard([
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
            data: { backName: 'back.me' },
            loadComponent: () => import('./features/me/pages/my-page/my-page').then((m) => m.MyPage),
          },
          {
            path: 'requests/:requestId',
            data: { backName: 'back.meRequest' },
            loadComponent: () =>
              import('./features/me/pages/my-request/my-request').then((m) => m.MyRequest),
          },
          {
            path: 'change',
            data: { backName: 'back.meChange' },
            loadComponent: () =>
              import('./features/me/pages/my-change/my-change').then((m) => m.MyChange),
          },
          {
            path: 'account',
            data: { backName: 'back.account' },
            loadComponent: () =>
              import('./features/account/pages/my-account/my-account').then((m) => m.MyAccountPage),
          },
        ],
      },
      // 事業所がまだない管理者のホーム（新規登録の直後はここ。11/12）
      {
        path: 'start',
        data: { backName: 'back.home' },
        canActivate: [staffGuard],
        loadComponent: () => import('./features/office/pages/welcome/welcome').then((m) => m.Welcome),
      },
      // 事業所がまだない管理者のアカウントの設定（パスワード・メールアドレスの変更。11/13）
      {
        path: 'start/account',
        data: { backName: 'back.account' },
        canActivate: [staffGuard],
        loadComponent: () => import('./features/office/pages/welcome/welcome-account').then((m) => m.WelcomeAccount),
      },
      {
        path: 'offices/new',
        data: { backName: 'back.officeNew', backSkip: true },
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
            data: { backName: 'back.home', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/dashboard/pages/dashboard/dashboard').then((m) => m.Dashboard),
          },
          {
            path: 'ages',
            data: { backName: 'back.ages', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/dashboard/pages/age-list/age-list').then((m) => m.AgeList),
          },
          {
            path: 'employees',
            data: { backName: 'back.employees', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/employees/pages/employee-list/employee-list').then(
                (m) => m.EmployeeList,
              ),
          },
          {
            // ファイルの取り込み（区分を選ぶ → ファイル → 取り込む。?kind=…&from=…。11/17）
            path: 'import',
            data: { backName: 'back.import' },
            loadComponent: () =>
              import('./features/employees/pages/employee-import/employee-import').then(
                (m) => m.EmployeeImport,
              ),
          },
          {
            // 古い URL：同じページを、区分と戻り先を決めて開く
            path: 'employees/import',
            data: { backName: 'back.import', kind: 'employees', from: 'employees' },
            loadComponent: () =>
              import('./features/employees/pages/employee-import/employee-import').then(
                (m) => m.EmployeeImport,
              ),
          },
          {
            path: 'employees/new',
            data: { backName: 'back.employeeNew', backSkip: true },
            loadComponent: () =>
              import('./features/employees/pages/employee-form/employee-form').then(
                (m) => m.EmployeeForm,
              ),
          },
          {
            path: 'employees/:employeeId',
            data: { backName: 'back.employee' },
            loadComponent: () =>
              import('./features/employees/pages/employee-detail/employee-detail').then(
                (m) => m.EmployeeDetail,
              ),
          },
          {
            path: 'employees/:employeeId/edit',
            data: { backName: 'back.employeeEdit', backSkip: true },
            loadComponent: () =>
              import('./features/employees/pages/employee-form/employee-form').then(
                (m) => m.EmployeeForm,
              ),
          },
          {
            // 期間ごとの会社負担の集計（11/24）
            path: 'premiums/period',
            data: { backName: 'back.premiumPeriod' },
            loadComponent: () =>
              import('./features/premiums/pages/premium-period/premium-period').then((m) => m.PremiumPeriod),
          },
          {
            path: 'premiums',
            data: { backName: 'back.premiums', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/premiums/pages/premium-list/premium-list').then(
                (m) => m.PremiumList,
              ),
          },
          {
            path: 'bonuses',
            data: { backName: 'back.bonuses', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/premiums/pages/bonus-list/bonus-list').then((m) => m.BonusList),
          },
          {
            // 賞与の項目（年4回以上かを数えるまとまりと、社会保険の扱い。11/19）
            path: 'bonuses/items',
            data: { backName: 'back.bonusItems' },
            loadComponent: () =>
              import('./features/premiums/pages/bonus-items/bonus-items').then((m) => m.BonusItems),
          },
          {
            path: 'bonuses/new',
            data: { backName: 'back.bonusNew', backSkip: true, wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/premiums/pages/bonus-form/bonus-form').then((m) => m.BonusForm),
          },
          {
            path: 'bonuses/:bonusId',
            data: { backName: 'back.bonus', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/premiums/pages/bonus-form/bonus-form').then((m) => m.BonusForm),
          },
          {
            // 左メニューの「給与」：入口のページ（今月の業務の「○月払いの給与を入力」→ 月の画面へ・決まること・月ごとの記録）
            // 11/28 本人のデモに合わせて、月の画面を直接開くのをやめた（どこを押せば入力が始まるかを一目で分かるように）
            path: 'payrolls',
            data: { backName: 'back.payrolls', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/payrolls/pages/payroll-list/payroll-list').then(
                (m) => m.PayrollList,
              ),
          },
          {
            // 古い URL（11/26〜11/27 の「月ごとの給与」）は入口のページへ。'payrolls/:month' より先に置く
            path: 'payrolls/months',
            redirectTo: 'payrolls',
          },
          {
            // 古い URL：ファイルの取り込みのページを、給与の実績を選んで開く（11/17）
            path: 'payrolls/import',
            data: { backName: 'back.import', kind: 'payrolls', from: 'payrolls' },
            loadComponent: () =>
              import('./features/employees/pages/employee-import/employee-import').then(
                (m) => m.EmployeeImport,
              ),
          },
          {
            // 給与の項目と分類（給与明細の項目名 → 社会保険での分類。11/24）。'payrolls/:month' より先に置く
            path: 'payrolls/items',
            data: { backName: 'back.payrollItems' },
            loadComponent: () =>
              import('./features/payrolls/pages/payroll-items/payroll-items').then((m) => m.PayrollItems),
          },
          {
            path: 'payrolls/:month',
            data: { backName: 'back.payrollMonth', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/payrolls/pages/payroll-month/payroll-month').then(
                (m) => m.PayrollMonth,
              ),
          },
          {
            path: 'calendar',
            data: { backName: 'back.calendar' },
            loadComponent: () =>
              import('./features/calendar/pages/calendar/calendar').then((m) => m.CalendarPage),
          },
          {
            path: 'filings',
            data: { backName: 'back.filings', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/filings/pages/filings/filings').then((m) => m.FilingsPage),
          },
          {
            path: 'regular/:year',
            data: { backName: 'back.regular', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/payrolls/pages/regular/regular').then((m) => m.RegularPage),
          },
          {
            path: 'revisions',
            data: { backName: 'back.revisions', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/payrolls/pages/revisions/revisions').then((m) => m.RevisionsPage),
          },
          {
            path: 'requests',
            data: { backName: 'back.requests', wide: true }, // 広い画面では表を横に伸ばす（11/16）
            loadComponent: () =>
              import('./features/requests/pages/request-list/request-list').then((m) => m.RequestList),
          },
          {
            path: 'requests/new',
            data: { backName: 'back.requestNew', backSkip: true },
            loadComponent: () =>
              import('./features/requests/pages/request-new/request-new').then((m) => m.RequestNew),
          },
          {
            path: 'requests/:requestId',
            data: { backName: 'back.request' },
            loadComponent: () =>
              import('./features/requests/pages/request-review/request-review').then((m) => m.RequestReview),
          },
          {
            path: 'help',
            data: { backName: 'back.help' },
            loadComponent: () => import('./features/help/pages/help/help').then((m) => m.HelpPage),
          },
          {
            path: 'account',
            data: { backName: 'back.account' },
            loadComponent: () => import('./features/account/pages/account/account').then((m) => m.AccountPage),
          },
          {
            path: 'members',
            data: { backName: 'back.members' },
            loadComponent: () =>
              import('./features/members/pages/members/members').then((m) => m.MembersPage),
          },
          {
            path: 'settings',
            data: { backName: 'back.settings', mode: 'edit' },
            loadComponent: () =>
              import('./features/office/pages/office-form/office-form').then((m) => m.OfficeForm),
          },
          {
            // 設定 › マスタ（給与・賞与の項目への入口、保険料額表と組合の料率の閲覧。11/26）
            path: 'settings/masters',
            data: { backName: 'back.settings', tabRoot: true }, // タブの切り替えは「前の画面」に積まない
            loadComponent: () =>
              import('./features/office/pages/masters/masters').then((m) => m.Masters),
          },
        ],
      },
    ],
  },

  { path: '**', redirectTo: '' },
]);
