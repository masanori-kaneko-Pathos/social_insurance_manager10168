/** 健康保険・厚生年金それぞれの資格 */
export interface Enrollment {
    enrolled: boolean; // 加入するか（今は手でチェック）
    acquiredDate: string | null; // 資格取得日 'YYYY-MM-DD'
    lostDate: string | null; // 資格喪失日（退職日の翌日など）
  }