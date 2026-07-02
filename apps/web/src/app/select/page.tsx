import Link from "next/link";

/**
 * ゲーム選択画面のプレースホルダー。
 *
 * TOP画面からの遷移先を先に置く（リーダーの最小プレースホルダー）。
 * registry のマニフェストから自動生成する本実装は issue-06 で差し替える。
 */
export default function SelectPage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-6 py-16">
			<h1 className="font-bold text-3xl text-white">ゲームを選ぶ</h1>
			<p className="text-slate-300">準備中（issue-06 で実装）</p>
			<Link href="/" className="text-indigo-400 underline">
				TOP へ戻る
			</Link>
		</main>
	);
}
