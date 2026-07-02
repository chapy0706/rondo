import Link from "next/link";

/**
 * TOP画面。プラットフォームの入口。
 *
 * 縦画面・タッチ操作を基本とし（ADR 0012）、気軽に立ち寄れる軽い入口にする。
 * 役割はゲーム選択画面への導線までで、ゲームロジックやルームは持たない。
 */
export default function HomePage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-between gap-12 px-6 py-16 text-center">
			<div className="flex flex-1 flex-col items-center justify-center gap-4">
				<h1 className="font-bold text-6xl text-white tracking-tight">rondo</h1>
				<p className="text-balance text-lg text-slate-300">
					ちょっと集まって、少し遊んで、また明日。
				</p>
			</div>
			<Link
				href="/select"
				className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-indigo-500 px-8 font-semibold text-lg text-white transition-colors active:bg-indigo-600"
			>
				ゲームを選ぶ
			</Link>
		</main>
	);
}
