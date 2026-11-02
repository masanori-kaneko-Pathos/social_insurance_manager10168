export interface Industry {
    code: string;
    ja: string;
    en: string;
  }
  
  /** 日本標準産業分類（大分類） */
  export const INDUSTRIES: Industry[] = [
    { code: 'A', ja: '農業、林業', en: 'Agriculture and forestry' },
    { code: 'B', ja: '漁業', en: 'Fisheries' },
    { code: 'C', ja: '鉱業、採石業、砂利採取業', en: 'Mining and quarrying' },
    { code: 'D', ja: '建設業', en: 'Construction' },
    { code: 'E', ja: '製造業', en: 'Manufacturing' },
    { code: 'F', ja: '電気・ガス・熱供給・水道業', en: 'Electricity, gas, heat supply and water' },
    { code: 'G', ja: '情報通信業', en: 'Information and communications' },
    { code: 'H', ja: '運輸業、郵便業', en: 'Transport and postal activities' },
    { code: 'I', ja: '卸売業、小売業', en: 'Wholesale and retail trade' },
    { code: 'J', ja: '金融業、保険業', en: 'Finance and insurance' },
    { code: 'K', ja: '不動産業、物品賃貸業', en: 'Real estate and goods rental and leasing' },
    { code: 'L', ja: '学術研究、専門・技術サービス業', en: 'Scientific research, professional and technical services' },
    { code: 'M', ja: '宿泊業、飲食サービス業', en: 'Accommodations, eating and drinking services' },
    { code: 'N', ja: '生活関連サービス業、娯楽業', en: 'Living-related and personal services and amusement services' },
    { code: 'O', ja: '教育、学習支援業', en: 'Education, learning support' },
    { code: 'P', ja: '医療、福祉', en: 'Medical, health care and welfare' },
    { code: 'Q', ja: '複合サービス事業', en: 'Compound services' },
    { code: 'R', ja: 'サービス業（他に分類されないもの）', en: 'Services, n.e.c.' },
    { code: 'S', ja: '公務（他に分類されるものを除く）', en: 'Government, except elsewhere classified' },
    { code: 'T', ja: '分類不能の産業', en: 'Industries unable to classify' },
  ];