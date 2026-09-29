import Link from "next/link";
import { RondoWordmark } from "../platform/brand/Logo";

/**
 * TOP画面。プラットフォームの入口。
 *
 * 縦画面・タッチ操作を基本とし（ADR 0012）、気軽に立ち寄れる軽い入口にする。
 * 常時表示はロゴ・一言・選択画面への導線だけに絞る（ADR 0029）。配色とロゴは
 * rondo 独自のテーマ（globals.css / platform/brand）を使う。
 * 役割はゲーム選択画面への導線までで、ゲームロジックやルームは持たない。
 */
export default function HomePage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-between gap-12 px-6 py-16 text-center">
			<div className="flex flex-1 flex-col items-center justify-center gap-5 motion-safe:animate-rise">
				<h1>
					<RondoWordmark className="h-20 w-auto text-fg" />
				</h1>
				<p className="text-balance text-fg-muted text-lg">
					ちょっと集まって、少し遊んで、また明日。
				</p>
			</div>
			<Link
				href="/select"
				className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-accent px-8 font-semibold text-accent-fg text-lg transition-transform active:scale-[0.98] motion-safe:animate-rise"
			>
				ゲームを選ぶ
			</Link>
		</main>
	);
}
