import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  // inject は await より前に呼ぶ（await の後では使えない）
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady;
  if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);

  // ログイン済みでも、このアプリの users がなければ弾く
  return (await auth.ensureProfile())
    ? true
    : router.createUrlTree(['/login'], { queryParams: { reason: 'noAccount' } });
};