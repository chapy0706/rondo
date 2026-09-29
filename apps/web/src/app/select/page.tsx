import Link from "next/link";
import { registry } from "../../games/registry";
import { RondoMark } from "../../platform/brand/Logo";
import { Shelf } from "../../platform/select/Shelf";

/**
 * ゲーム選択画面。registry のマニフェストから横スクロールのシェルフを動的に生成する
 * （ADR 0003 / 0029）。
 *
 * 基盤の UI にゲーム固有の記述を持たない。ゲームを増やすときは registry に
 * マニフェストを登録するだけで、この画面のコードは変えずに選択肢が増える。
 * 常時表示はカードと設定アイコン、TOP へ戻る輪のマークだけに絞る。
 * 縦持ちのまま、シェルフを画面の中に置く（ADR 0012）。
 */
export default function SelectPage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col">
			<h1 className="sr-only">ゲームを選ぶ</h1>
			<nav className="flex items-center justify-between px-3 pt-3">
				<Link
					href="/"
					aria-label="TOP へ戻る"
					className="flex size-11 items-center justify-center rounded-full active:bg-surface"
				>
					<RondoMark className="size-6" />
				</Link>
				<Link
					href="/settings"
					aria-label="設定"
					className="flex size-11 items-center justify-center rounded-full text-fg-muted active:bg-surface"
				>
					<SettingsIcon />
				</Link>
			</nav>

			<div className="flex flex-1 flex-col justify-center pb-16">
				{registry.length === 0 ? (
					<p className="text-center text-fg-muted">
						まだ遊べるゲームがありません。
					</p>
				) : (
					<Shelf manifests={registry} />
				)}
			</div>
		</main>
	);
}

/** 設定アイコン。3 本のつまみ（スライダー）で「調整する」を表す。 */
function SettingsIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className="size-6"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
		>
			<path d="M4 6h16M4 12h16M4 18h16" />
			<circle cx="9" cy="6" r="2.25" fill="var(--color-ink)" />
			<circle cx="15" cy="12" r="2.25" fill="var(--color-ink)" />
			<circle cx="7" cy="18" r="2.25" fill="var(--color-ink)" />
		</svg>
	);
}
