import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * 役割で入口を分ける（authGuard のあとで使う。profile は読み込み済み）
 * - employeeGuard：マイページ（/me）は従業員のアカウントだけ
 * - staffGuard：事務所の画面は、従業員のアカウントでは入れない（/me へ）
 * データを守るのはルール。ここは「迷い込まない」ための道案内
 */
export const employeeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.profile()?.role === 'employee' ? true : router.createUrlTree(['/']);
};

export const staffGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.profile()?.role === 'employee' ? router.createUrlTree(['/me']) : true;
};
