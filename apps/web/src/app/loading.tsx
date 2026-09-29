import { RondoMark } from "../platform/brand/Logo";

/**
 * 画面の読み込み中に出す表現（issue-05）。
 *
 * rondo の輪が脈打つだけの簡潔なもの。待ち時間を足さず、読み込みが終われば消える。
 * 動きを減らす設定では脈打ちを止める。
 */
export default function Loading() {
	return (
		<main className="flex min-h-dvh items-center justify-center">
			<output className="flex flex-col items-center gap-3">
				<RondoMark className="size-12 motion-safe:animate-pulse" />
				<span className="sr-only">読み込み中</span>
			</output>
		</main>
	);
}
