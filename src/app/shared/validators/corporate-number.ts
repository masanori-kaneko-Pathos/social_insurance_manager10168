import { AbstractControl, ValidationErrors } from '@angular/forms';

/** 法人番号（13桁）のチェックデジットを検証する */
export function isValidCorporateNumber(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const check = Number(value[0]);
  const base = value.slice(1); // 残り12桁
  let sum = 0;
  for (let n = 1; n <= 12; n++) {
    const digit = Number(base[12 - n]); // 右から n 番目
    sum += digit * (n % 2 === 1 ? 1 : 2);
  }
  return check === 9 - (sum % 9);
}

/** 空欄はOK（任意項目）。入力があれば検証する */
export function corporateNumberValidator(control: AbstractControl): ValidationErrors | null {
  const v = (control.value ?? '').trim();
  if (!v) return null;
  return isValidCorporateNumber(v) ? null : { corporateNumber: true };
}