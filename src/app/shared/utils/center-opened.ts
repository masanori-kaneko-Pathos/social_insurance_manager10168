// 行を開いたら、その行と下に開いた中身を画面の真ん中へ、なめらかに動かす（11/27）
// - 行＋中身が画面に収まるなら、上下の余白が同じになる位置へ
// - 収まらない（中身が長い）なら、行の頭を見出しのすぐ下へ（行が見えなくならないように）
// - もう見やすい位置にあるなら動かさない（少しだけ動いてガタつくのを防ぐ）
// - 動きを減らす設定（prefers-reduced-motion）のときは、すぐに移る

/** 行の上下と、画面の中で使える範囲（見出しの下〜保存の帯の上） */
export interface CenterInput {
  /** 行の上端・中身の下端（画面の上からの位置） */
  top: number;
  bottom: number;
  /** 使える範囲（画面の上からの位置） */
  viewTop: number;
  viewBottom: number;
  /** いまのスクロール位置 */
  scrollY: number;
}

/** 行の頭を見出しから離す幅（px） */
const GAP = 8;
/** これより小さい動きはしない（px） */
const MIN_MOVE = 24;

/** 動かす先のスクロール位置（動かさないときは null）。Angular・DOM に依存しない純粋な関数 */
export function centerScrollY(x: CenterInput): number | null {
  const avail = x.viewBottom - x.viewTop;
  const height = x.bottom - x.top;
  const wantTop = height + GAP * 2 <= avail ? x.viewTop + (avail - height) / 2 : x.viewTop + GAP;
  const delta = x.top - wantTop;
  if (Math.abs(delta) < MIN_MOVE) return null;
  return Math.max(0, Math.round(x.scrollY + delta));
}

/**
 * 開いた行を真ん中へ。行は [data-row="id"]、中身はそのすぐ下の行（.detail・.detail-row）
 * 開いた直後は中身がまだ描かれていないので、描かれてから測る
 */
export function centerOpenedRow(id: string): void {
  setTimeout(() =>
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(id)}"]`);
      if (!row) return;
      const next = row.nextElementSibling;
      const detail = next?.matches('.detail, .detail-row') ? next : null;
      const r = row.getBoundingClientRect();
      const bottom = (detail ?? row).getBoundingClientRect().bottom;
      // 上：表の見出しが画面の上に貼り付く表では、その高さぶん下から
      const head = row.closest('table.sticky-head')?.querySelector('thead');
      const viewTop = head ? head.getBoundingClientRect().height : 0;
      // 下：保存の帯が画面の下に貼り付いていれば、その上まで
      const bar = document.querySelector<HTMLElement>('.save-bar');
      const barRect = bar?.getBoundingClientRect();
      const viewBottom = barRect && barRect.top < window.innerHeight ? barRect.top : window.innerHeight;
      const y = centerScrollY({ top: r.top, bottom, viewTop, viewBottom, scrollY: window.scrollY });
      if (y === null) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    }),
  );
}
