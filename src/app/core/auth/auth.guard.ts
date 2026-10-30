import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  // inject は await より前に呼ぶ（await の後では使えない）
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady;
  return auth.isLoggedIn() ? true : router.createUrlTree(['/login']);
};