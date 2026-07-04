import Link from "next/link";
import { registry } from "../../games/registry";
import { GameCard } from "../../platform/select/GameCard";

/**
 * ゲーム選択画面。registry のマニフェストからカードを動的に生成する（ADR 0003）。
 *
 * 基盤の UI にゲーム固有の記述を持たない。ゲームを増やすときは registry に
 * マニフェストを登録するだけで、この画面のコードは変えずに選択肢が増える。
 * 純粋な RSC として、起動が軽い入口を保つ（ADR 0012）。
 */
export default function SelectPage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-6 py-16">
			<h1 className="font-bold text-3xl text-white">ゲームを選ぶ</h1>

			{registry.length === 0 ? (
				<p className="text-slate-400">まだ遊べるゲームがありません。</p>
			) : (
				<ul className="flex flex-col gap-4">
					{registry.map((manifest) => (
						<li key={manifest.id}>
							<GameCard manifest={manifest} />
						</li>
					))}
				</ul>
			)}

			<Link href="/" className="text-indigo-400 underline">
				TOP へ戻る
			</Link>
		</main>
	);
}
