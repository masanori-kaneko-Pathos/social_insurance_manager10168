// Shift_JIS で書き出す（届書作成プログラムが読む CSV。日本年金機構「別添1 コード規定」）
// - 1バイト：JIS8（JIS X 0201）の英数字・記号・半角カナ
// - 2バイト：JIS X 0208（第1水準・第2水準）。NEC・IBM の拡張文字（①・㈱・髙など）は使えない
//
// ブラウザには Shift_JIS で「書く」仕組みがない。ただ「読む」仕組み（TextDecoder）はあるので、
// 使ってよい範囲のバイトをすべて読ませて、文字 → バイト の対応表をその場で作る（追加の部品は要らない）。
// Angular・Firebase に依存しない純粋な関数

let table: Map<string, number[]> | null = null;

/** 文字 → Shift_JIS のバイト（初めて呼ばれたときに1回だけ作る） */
function sjisTable(): Map<string, number[]> {
  if (table) return table;
  const map = new Map<string, number[]>();
  const dec = new TextDecoder('shift_jis');
  // 1バイト：表示できる ASCII（0x20〜0x7E）と半角カナ（0xA1〜0xDF）
  for (let b = 0x20; b <= 0xdf; b++) {
    if (b > 0x7e && b < 0xa1) continue;
    const ch = dec.decode(new Uint8Array([b]));
    if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [b]);
  }
  // 2バイト：JIS X 0208 の範囲（記号 0x81〜0x84、第1・第2水準の漢字 0x88〜0x9F・0xE0〜0xEA）
  const leads = [0x81, 0x82, 0x83, 0x84];
  for (let b = 0x88; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xea; b++) leads.push(b);
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [lead, trail]);
    }
  }
  table = map;
  return map;
}

/**
 * 見た目が同じで、Shift_JIS にない文字を言い換える
 * （− MINUS SIGN → － 全角ハイフンマイナス、〜 WAVE DASH → ～、‐ HYPHEN → ‐ のまま 等）
 */
export function normalizeForSjis(s: string): string {
  return s
    .replace(/\u2212/g, '\uFF0D') // −
    .replace(/\u301C/g, '\uFF5E') // 〜
    .replace(/\u2016/g, '\u2225') // ‖
    .replace(/\u00A2/g, '\uFFE0') // ¢
    .replace(/\u00A3/g, '\uFFE1') // £
    .replace(/\u00AC/g, '\uFFE2'); // ¬
}

/** Shift_JIS（JIS X 0208 まで）で書けない文字（重ならないよう1回ずつ） */
export function unsupportedChars(s: string): string[] {
  const t = sjisTable();
  const out: string[] = [];
  for (const ch of s) {
    if (ch === '\r' || ch === '\n') continue;
    if (!t.has(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/** 文字列 → Shift_JIS のバイト。書けない文字があれば例外（先に unsupportedChars で確かめる） */
export function encodeSjis(s: string): Uint8Array {
  const t = sjisTable();
  const out: number[] = [];
  for (const ch of s) {
    if (ch === '\n') {
      out.push(0x0d, 0x0a);
      continue;
    }
    if (ch === '\r') continue;
    const b = t.get(ch);
    if (!b) throw new Error(`Shift_JIS にない文字：${ch}`);
    out.push(...b);
  }
  return new Uint8Array(out);
}

// ===== 半角カナ（「カナ」の項目は1バイトの半角カナ。濁点・半濁点は別の1文字） =====

const FULL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォャュョッー・';
const HALF = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｬｭｮｯｰ･';
const DAKU = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボ';
const DAKU_BASE = 'カキクケコサシスセソタチツテトハヒフヘホ';
const HANDAKU = 'パピプペポ';
const HANDAKU_BASE = 'ハヒフヘホ';

/** ひらがな・全角カタカナ・全角英数 → 半角カナ・半角英数（ヴは ｳﾞ、ヰ・ヱ は ｲ・ｴ） */
export function toHalfKana(s: string): string {
  let out = '';
  for (const raw of s) {
    // ひらがな → カタカナ
    const code = raw.charCodeAt(0);
    const ch = code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : raw;
    let i: number;
    if ((i = DAKU.indexOf(ch)) >= 0) out += HALF[FULL.indexOf(DAKU_BASE[i])] + 'ﾞ';
    else if ((i = HANDAKU.indexOf(ch)) >= 0) out += HALF[FULL.indexOf(HANDAKU_BASE[i])] + 'ﾟ';
    else if (ch === 'ヴ') out += 'ｳﾞ';
    else if (ch === 'ヰ') out += 'ｲ';
    else if (ch === 'ヱ') out += 'ｴ';
    else if (ch === 'ヮ') out += 'ﾜ';
    else if ((i = FULL.indexOf(ch)) >= 0) out += HALF[i];
    else if (ch === '　') out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0); // 全角英数・記号
    else out += ch;
  }
  return out;
}

/** CSV の1行（区切り文字・改行・引用符は入れない前提で、そのままカンマでつなぐ） */
export function toPlainCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map((c) => c.replace(/[,"\r\n]/g, ' ')).join(',')).join('\n') + '\n';
}

/** Shift_JIS の CSV を保存する */
export function downloadSjisCsv(fileName: string, rows: readonly (readonly string[])[]): void {
  const bytes = encodeSjis(toPlainCsv(rows));
  const blob = new Blob([bytes as BlobPart], { type: 'text/csv;charset=shift_jis' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
