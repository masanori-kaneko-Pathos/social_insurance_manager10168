import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { OfficeService } from './office.service';

export const startGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const offices = inject(OfficeService);
  const router = inject(Router);

  const uid = auth.user()!.uid;

  // 0. 従業員のアカウントはマイページへ
  if (auth.profile()?.role === 'employee') return router.createUrlTree(['/me']);

  // 1. 最後に開いた事業所が読めれば、そこへ
  const currentId = auth.profile()?.currentOfficeId;
  if (currentId && (await offices.tryGet(currentId))) {
    return router.createUrlTree(['/o', currentId]);
  }

  // 2. 読めなければ、所属している事業所の1つ目へ
  const mine = await offices.listMine(uid);
  if (mine.length > 0) {
    return router.createUrlTree(['/o', mine[0].id]);
  }

  // 3. 1つもなければ、登録画面へ
  return router.createUrlTree(['/offices/new']);
};