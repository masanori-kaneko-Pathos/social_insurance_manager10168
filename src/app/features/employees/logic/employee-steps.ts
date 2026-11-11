/**
 * 従業員の登録の段（段階式の登録）。編集の画面は1ページのまま（段を使わない）
 * Angular・Firebase に依存しない純粋な関数：段の並び・段ごとに確かめる欄とフォーム全体のエラー
 *
 * 保存は最後の「登録する」の1回だけ（下書きは作らない。下書きの人が To-do・保険料・給与に紛れ込まないように）
 */

export type EmployeeStep = 'basic' | 'employment' | 'contract' | 'private' | 'foreign' | 'confirm';

/**
 * 段の並び（外国籍の段は外国籍の人だけ）
 * 雇用契約の段は「雇用・加入」のすぐあと（区分の判定に使う。入力欄は契約のカードと同じ部品で、フォームは別に持つ）
 */
export function stepsFor(foreign: boolean): EmployeeStep[] {
  return foreign
    ? ['basic', 'employment', 'contract', 'private', 'foreign', 'confirm']
    : ['basic', 'employment', 'contract', 'private', 'confirm'];
}

/** 段ごとに確かめる欄（フォームの中の場所。まとまりなら中の欄を全部） */
export const STEP_CONTROLS: Record<Exclude<EmployeeStep, 'confirm'>, readonly string[]> = {
  // 基本情報のカードには、外国籍の人のローマ字氏名・漢字氏名・通称名も入っている
  basic: [
    'employeeNumber',
    'lastName',
    'firstName',
    'lastNameKana',
    'firstNameKana',
    'birthDate',
    'sex',
    'foreign.romanLastName',
    'foreign.romanFirstName',
    'foreign.romanMiddleName',
    'foreign.noRomanReasonText',
    'foreign.kanjiName',
    'foreign.alias',
  ],
  employment: [
    'hireDate',
    'retireDate',
    'retireReason',
    'health',
    'pension',
    'insuredNumber',
    'basicPensionNumber',
    'collectionMethod',
  ],
  contract: [], // 契約は従業員のフォームの外（契約のフォームで確かめる）
  private: ['contact', 'commute', 'bankAccount'],
  foreign: [
    'foreign.nationality',
    'foreign.residenceCardNumber',
    'foreign.residenceStatus',
    'foreign.residenceExpiry',
    'foreign.workPermitHours',
    'foreign.certCountry',
    'foreign.certFrom',
    'foreign.certTo',
  ],
};

/** 段ごとに見る、フォーム全体のエラー（日付の前後関係・国籍で変わる必須） */
export const STEP_ERRORS: Record<Exclude<EmployeeStep, 'confirm'>, readonly string[]> = {
  basic: [
    'lastNameRequired',
    'firstNameRequired',
    'firstNameKanaRequired',
    'birthFuture',
    'romanRequired',
    'noRomanReasonTextRequired',
    'kanjiNameIncomplete',
    'aliasIncomplete',
    'filingNameMissing',
  ],
  employment: [
    'birthTooYoung',
    'retireBeforeHire',
    'healthAcquiredRequired',
    'healthLostBeforeAcquired',
    'pensionAcquiredRequired',
    'pensionLostBeforeAcquired',
  ],
  contract: [],
  private: ['bankIncomplete'],
  foreign: ['nationalityRequired', 'certificateRequired', 'certificateOrder'],
};

/**
 * その段で先へ進めるか
 * invalidPaths：エラーのある欄の場所、formErrors：フォーム全体のエラーの名前
 */
export function stepBlocked(
  step: EmployeeStep,
  invalidPaths: readonly string[],
  formErrors: readonly string[],
): boolean {
  if (step === 'confirm') return invalidPaths.length > 0 || formErrors.length > 0;
  const controls = STEP_CONTROLS[step];
  const inStep = (p: string) => controls.some((c) => p === c || p.startsWith(c + '.'));
  return invalidPaths.some(inStep) || formErrors.some((e) => STEP_ERRORS[step].includes(e));
}

/** 次の段（最後なら同じ段） */
export function nextStep(steps: readonly EmployeeStep[], current: EmployeeStep): EmployeeStep {
  const i = steps.indexOf(current);
  return steps[Math.min(i + 1, steps.length - 1)] ?? current;
}

export function prevStep(steps: readonly EmployeeStep[], current: EmployeeStep): EmployeeStep {
  const i = steps.indexOf(current);
  return steps[Math.max(i - 1, 0)] ?? current;
}
