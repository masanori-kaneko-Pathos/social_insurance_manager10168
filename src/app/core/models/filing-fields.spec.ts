/**
 * 答え合わせの表（データの地図 1章）
 * 届書の欄 → どの入れ物のどの項目か。項目の名前を変えたり消したりすると、ここが型エラーになって気づける。
 * 「計算」と書いた欄は保存しない（毎回計算する）。
 */
import { BonusPaymentDoc } from './bonus';
import { ContractDoc } from './contract';
import { DependentDoc } from './dependent';
import { EmployeeDoc, EnrollmentDoc, Leave } from './employee';
import { OfficeDoc } from './office';
import { PayrollInput } from './payroll';
import { IrregularDecisionDoc, RegularDecisionDoc } from './revision';

type Field<T> = keyof T | 'calc';

/** 資格取得届 */
const ACQUISITION: Record<string, Field<EmployeeDoc> | Field<ContractDoc> | Field<OfficeDoc> | Field<EnrollmentDoc>> = {
  被保険者整理番号: 'insuredNumber',
  氏名: 'lastName',
  フリガナ: 'lastNameKana',
  生年月日: 'birthDate',
  種別_性別: 'sex',
  種別_基金: 'pensionFund',
  取得区分: 'acquisitionType',
  基礎年金番号: 'basicPensionNumber',
  取得年月日: 'acquiredDate',
  被扶養者の有無: 'calc',
  報酬月額_通貨: 'expectedCash',
  報酬月額_現物: 'expectedInKind',
  備考_70歳以上被用者: 'calc',
  備考_二以上事業所: 'multipleOffices',
  備考_短時間労働者: 'calc',
  備考_継続再雇用: 'rehired',
  住所: 'contact',
  資格確認書: 'needsConfirmationCard',
};

/** 資格喪失届 */
const LOSS: Record<string, Field<EmployeeDoc> | Field<EnrollmentDoc>> = {
  喪失年月日: 'lostDate',
  喪失の原因: 'lossReason',
  備考_二以上事業所: 'multipleOffices',
  不該当_退職日: 'retireDate',
  退職の理由: 'retireReason',
};

/** 算定基礎届 */
const REGULAR: Record<string, Field<RegularDecisionDoc> | Field<PayrollInput>> = {
  支払基礎日数: 'days',
  通貨: 'cash',
  現物: 'inKind',
  遡及支払額: 'retro',
  総計: 'total',
  平均額: 'average',
  修正平均額: 'corrected',
  備考_年間平均: 'method',
  備考_病休育休休職: 'state',
};

/** 月額変更届 */
const IRREGULAR: Record<string, Field<IrregularDecisionDoc>> = {
  改定年月: 'revisedFrom',
  昇給降給: 'direction',
  遡及支払額: 'retro',
  総計: 'total',
  平均額: 'average',
  修正平均額: 'corrected',
  昇給降給の理由: 'reasonNote',
};

/** 賞与支払届 */
const BONUS: Record<string, Field<BonusPaymentDoc>> = {
  支払年月日: 'paidDate',
  賞与額_通貨: 'amounts',
  賞与額_現物: 'inKindAmounts',
};

/** 被扶養者（異動）届・第3号 */
const DEPENDENT: Record<string, Field<DependentDoc>> = {
  氏名: 'lastName',
  生年月日: 'birthDate',
  性別: 'sex',
  続柄: 'relationship',
  同居別居: 'livingTogether',
  住所: 'address',
  職業: 'occupation',
  収入: 'annualIncome',
  認定日: 'from',
  削除日: 'to',
  理由: 'endReason',
  配偶者の基礎年金番号: 'basicPensionNumber',
  第3号: 'thirdInsured',
};

/** 産休・育休の申出書 */
const LEAVE: Record<string, Field<Leave>> = {
  種類: 'kind',
  開始: 'start',
  終了: 'end',
  出産予定日: 'expectedBirthDate',
  出産日: 'birthDate',
  多胎: 'multipleBirth',
  子の氏名: 'childName',
  子の生年月日: 'childBirthDate',
  就業日数: 'workDays',
};

/** 被保険者区分変更届・加入判定 */
const CATEGORY: Record<string, Field<ContractDoc> | Field<OfficeDoc> | Field<EmployeeDoc>> = {
  週の所定労働時間: 'weeklyMinutes',
  月の所定労働日数: 'monthlyDays',
  通常の労働者の所定: 'standardHours',
  特定適用事業所: 'specificApplication',
  所定内賃金: 'scheduledWage',
  減額の特例許可: 'minimumWageReduction',
  学生: 'student',
  雇用期間: 'periodEnd',
  加入の申し出: 'optInDate',
  区分: 'calc',
};

describe('答え合わせの表（届書の欄 → 入れ物の項目）', () => {
  const tables = { ACQUISITION, LOSS, REGULAR, IRREGULAR, BONUS, DEPENDENT, LEAVE, CATEGORY };
  for (const [name, table] of Object.entries(tables)) {
    it(`${name}：すべての欄に行き先がある`, () => {
      for (const [label, field] of Object.entries(table)) {
        expect(`${label}:${String(field)}`).toBeTruthy();
      }
      expect(Object.keys(table).length).toBeGreaterThan(0);
    });
  }
});
