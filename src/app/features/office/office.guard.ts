import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UserProfileService } from '../../core/auth/user-profile.service';
import { OfficeContext } from './office-context.service';
import { OfficeService } from './office.service';

export const officeGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const profiles = inject(UserProfileService);
  const offices = inject(OfficeService);
  const context = inject(OfficeContext);
  const router = inject(Router);

  const officeId = route.paramMap.get('officeId')!;
  const office = await offices.tryGet(officeId);

  // 読めない（メンバーでない・存在しない）→ / に戻して振り分け直す
  if (!office) return router.createUrlTree(['/']);

  context.setCurrent(office);

  const uid = auth.user()!.uid;
  if (context.mine().length === 0) {
    await context.refresh(uid);
  }
  if (auth.profile()?.currentOfficeId !== officeId) {
    profiles.setCurrentOffice(uid, officeId).catch((err) => console.error(err));
  }
  return true;
};