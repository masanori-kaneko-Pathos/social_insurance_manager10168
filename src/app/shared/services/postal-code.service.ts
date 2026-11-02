import { Injectable } from '@angular/core';

export interface PostalResult {
  prefCode: string; // '01'〜'47'
  city: string; // 市区町村
  town: string; // 町域
}

interface ZipcloudResponse {
  status: number;
  message: string | null;
  results: { prefcode: string; address2: string; address3: string }[] | null;
}

@Injectable({ providedIn: 'root' })
export class PostalCodeService {
  /** 7桁の郵便番号から住所を引く。見つからなければ null、通信失敗は例外 */
  async lookup(code7: string): Promise<PostalResult | null> {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${code7}`);
    if (!res.ok) throw new Error(`zipcloud HTTP ${res.status}`);

    const json = (await res.json()) as ZipcloudResponse;
    if (json.status !== 200) throw new Error(json.message ?? 'zipcloud error');

    const r = json.results?.[0];
    if (!r) return null;
    return { prefCode: r.prefcode.padStart(2, '0'), city: r.address2, town: r.address3 };
  }
}