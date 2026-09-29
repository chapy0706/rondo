import Link from "next/link";

/**
 * 設定画面（準備中）。
 *
 * 選択画面の設定アイコンの遷移先として場所だけを用意する（issue-06）。
 * 表示名の変更（ADR 0015）などの中身は後続の issue で入れる。
 */
export default function SettingsPage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
			<h1 className="font-semibold text-fg text-xl">設定</h1>
			<p className="text-fg-muted">設定は準備中です。</p>
			<Link
				href="/select"
				className="flex min-h-11 items-center rounded-full px-5 text-accent active:bg-surface"
			>
				ゲーム選択へ戻る
			</Link>
		</main>
	);
}
