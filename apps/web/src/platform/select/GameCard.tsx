import type { GameManifest } from "@rondo/contracts";
import Link from "next/link";
import type { MouseEvent } from "react";
import { fallbackInitial } from "./selection";

/**
 * シェルフのゲームカード。マニフェスト 1 件を選択肢として描く（ADR 0003 / 0029）。
 *
 * このコンポーネントは特定のゲームを知らず、マニフェストの自己記述だけを読む。
 * 頭文字のフォールバックを下に敷き、その上にサムネイルを背景画像として重ねるので、
 * 画像が未配置でも頭文字のタイルとして違和感なく並ぶ。
 * 選択中のカードは拡大・強調する。押したときの振る舞い（起動か、中央へ寄せるか）は
 * シェルフが onClick で決める。
 */
export function GameCard({
	manifest,
	selected,
	onClick,
	onFocus,
}: {
	manifest: GameManifest;
	selected: boolean;
	onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
	onFocus: () => void;
}) {
	return (
		<Link
			href={`/play/${manifest.id}`}
			aria-label={manifest.title}
			aria-current={selected ? "true" : undefined}
			onClick={onClick}
			onFocus={onFocus}
			className={`relative block aspect-square w-40 overflow-hidden rounded-3xl bg-surface outline-none ring-inset motion-safe:transition-[transform,opacity,box-shadow] motion-safe:duration-300 focus-visible:outline-2 focus-visible:outline-sub focus-visible:outline-offset-4 ${
				selected
					? "scale-110 opacity-100 shadow-[0_12px_32px_-8px] shadow-accent/40 ring-2 ring-accent"
					: "scale-90 opacity-50 ring-1 ring-line"
			}`}
		>
			<span
				aria-hidden="true"
				className="absolute inset-0 flex items-center justify-center font-bold text-7xl text-fg-muted"
			>
				{fallbackInitial(manifest)}
			</span>
			<span
				aria-hidden="true"
				className="absolute inset-0 bg-center bg-cover"
				style={{ backgroundImage: `url(${manifest.thumbnail})` }}
			/>
		</Link>
	);
}
