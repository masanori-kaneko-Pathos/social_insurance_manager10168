// 取り込みのエラーを窓で直すときの欄の種類（従業員・扶養家族・履歴・協定・海外勤務。11/17）
// 選ぶ列は、画面で1人ずつ入れるときと同じ選択肢（同じ翻訳の鍵）。表に戻す言葉は、取り込みが読む言葉

import { byHeader, choices, DATE, FixField, MONTH, NUMBER, YES_NO } from '../../../shared/import/fix-fields';
import { CERTIFICATE_CSV_HEADERS, OVERSEAS_CSV_HEADERS } from './abroad-csv';
import { DEPENDENT_CSV_HEADERS } from './dependent-csv';
import { EMPLOYEE_CSV_HEADERS } from './employee-csv';
import { CONTRACT_HISTORY_HEADERS, REMUNERATION_HISTORY_HEADERS } from './history-csv';

const SEX = choices('employee.sex', [
  ['男', 'male'],
  ['女', 'female'],
]);

/** 契約の列（従業員の取り込みと、契約の履歴で同じ） */
const CONTRACT = {
  employmentType: choices('contract.employmentType', [
    ['正社員', 'regular'],
    ['契約社員', 'contract'],
    ['パート', 'part'],
    ['アルバイト', 'arbeit'],
    ['嘱託', 'shokutaku'],
    ['その他', 'other'],
  ]),
  payType: choices('contract.payType', [
    ['月給', 'monthly'],
    ['日給月給', 'dailyMonthly'],
    ['日給', 'daily'],
    ['時給', 'hourly'],
  ]),
  monthlyDays: NUMBER,
  hourlyWage: NUMBER,
  dailyWage: NUMBER,
  scheduledWage: NUMBER,
  expectedCash: NUMBER,
  expectedInKind: NUMBER,
  periodEnd: DATE,
  renewal: choices('contract.renewal', [
    ['更新しない', 'none'],
    ['更新する場合がある', 'possible'],
    ['更新する', 'expected'],
  ]),
  student: choices('contract.student', [
    ['いいえ', 'none'],
    ['昼間', 'daytime'],
    ['夜間', 'other'],
  ]),
  minimumWageReduction: YES_NO,
  specialEmployment: choices('contract.specialEmployment', [
    ['ふつう', 'none'],
    ['日雇い', 'daily'],
    ['季節的業務', 'seasonal'],
    ['臨時的事業', 'temporaryBusiness'],
  ]),
  renewalPrecedent: YES_NO,
  noExtensionAgreed: YES_NO,
} satisfies Record<string, FixField>;

const LEAVE = choices('leave.kind', [
  ['産休', 'maternity'],
  ['育休', 'childcare'],
  ['出生時育休', 'paternity'],
  ['介護休業', 'care'],
  ['休職', 'suspension'],
]);

export const EMPLOYEE_FIX_FIELDS = byHeader(EMPLOYEE_CSV_HEADERS, {
  birthDate: DATE,
  sex: SEX,
  hireDate: DATE,
  retireDate: DATE,
  retireReason: choices('employee.retireReason', [
    ['退職', 'resign'],
    ['死亡', 'death'],
    ['転勤', 'transfer'],
    ['その他', 'other'],
  ]),
  healthEnrolled: YES_NO,
  pensionEnrolled: YES_NO,
  monthlyAmount: NUMBER,
  remunerationFrom: MONTH,
  optInDate: DATE,
  optOutDate: DATE,
  ...CONTRACT,
  leave1Kind: LEAVE,
  leave1Start: DATE,
  leave1End: DATE,
  leave1Birth: DATE,
  leave2Kind: LEAVE,
  leave2Start: DATE,
  leave2End: DATE,
  leave2Birth: DATE,
});

export const CONTRACT_HISTORY_FIX_FIELDS = byHeader(CONTRACT_HISTORY_HEADERS, { from: DATE, ...CONTRACT });

export const REMUNERATION_HISTORY_FIX_FIELDS = byHeader(REMUNERATION_HISTORY_HEADERS, {
  from: MONTH,
  reason: choices('remuneration.reason', [
    ['資格取得時決定', 'acquisition'],
    ['定時決定', 'regular'],
    ['随時改定', 'irregular'],
    ['休業終了', 'leaveEnd'],
    ['特例改定', 'special'],
    ['その他', 'other'],
  ]),
  monthlyAmount: NUMBER,
  healthGrade: NUMBER,
  pensionGrade: NUMBER,
});

export const DEPENDENT_FIX_FIELDS = byHeader(DEPENDENT_CSV_HEADERS, {
  relationship: choices('dependent.relationship', [
    ['配偶者', 'spouse'],
    ['子', 'child'],
    ['配偶者の子', 'otherChild'],
    ['父母', 'parent'],
    ['義父母', 'parentInLaw'],
    ['弟妹', 'youngerSibling'],
    ['兄姉', 'olderSibling'],
    ['祖父母', 'grandparent'],
    ['曽祖父母', 'greatGrandparent'],
    ['孫', 'grandchild'],
    ['その他', 'other'],
  ]),
  birthDate: DATE,
  from: DATE,
  sex: SEX,
  livingTogether: YES_NO,
  annualIncome: NUMBER,
  occupation: choices('dependent.occupation', [
    ['無職', 'none'],
    ['パート', 'partTime'],
    ['年金受給者', 'pensioner'],
    ['小中学生以下', 'child'],
    ['高・大学生', 'student'],
    ['その他', 'other'],
  ]),
  disabled: YES_NO,
  startReason: choices('dependent.startReason', [
    ['被保険者の就職', 'spouseEmployment'],
    ['婚姻', 'marriage'],
    ['離職', 'leftJob'],
    ['収入減少', 'incomeDecrease'],
    ['出生', 'birth'],
    ['同居', 'cohabitation'],
    ['その他', 'other'],
  ]),
  to: DATE,
  endReason: choices('dependent.endReason', [
    ['死亡', 'death'],
    ['離婚', 'divorce'],
    ['就職', 'employment'],
    ['収入増加', 'incomeIncrease'],
    ['75歳到達', 'age75'],
    ['障害認定', 'disability'],
    ['その他', 'other'],
  ]),
  remittance: NUMBER,
  remittanceTimes: NUMBER,
});

export const CERTIFICATE_FIX_FIELDS = byHeader(CERTIFICATE_CSV_HEADERS, {
  covers: choices('employee.certCovers', [
    ['年金だけ', 'pension'],
    ['年金と医療', 'pensionAndHealth'],
  ]),
  from: DATE,
  to: DATE,
});

export const OVERSEAS_FIX_FIELDS = byHeader(OVERSEAS_CSV_HEADERS, {
  from: DATE,
  to: DATE,
  payer: choices('overseas.payer', [
    ['日本の会社だけ', 'japan'],
    ['日本と海外の会社の両方', 'both'],
    ['海外の会社だけ', 'abroad'],
  ]),
  certificateFrom: DATE,
  certificateTo: DATE,
});
