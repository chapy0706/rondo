/**
 * 初心者モードの案内キャラクター（本家 BeginnerMascotDock の中身）。
 *
 * 本家は画面に浮かせてドラッグでき、位置を localStorage に保存していた。rondo では
 * czz の画面の中に置き（採点ボタン等に重ならない）、何も保存しない（ADR 0019）。
 */

import { MASCOT, type MascotMood } from "../presentation";
import { T } from "./theme";

const HINT = "命令をタップで追加、数字を入れたら採点しよう";

export function Mascot({ mood }: { mood: MascotMood }) {
	const { src, message } = MASCOT[mood];
	return (
		<div
			className={`flex items-center gap-3 px-3 py-2 shadow-sm ${T.radius} ${T.border} bg-[var(--czz-card)]/80`}
		>
			<span className="relative size-14 shrink-0 overflow-hidden rounded-full border border-[var(--czz-border)] bg-white">
				<img
					src={src}
					alt="初心者モードの案内キャラクター"
					width={56}
					height={56}
					className="size-full object-cover"
				/>
			</span>
			<span className="min-w-0">
				<span className="block font-medium text-sm leading-tight">
					{message}
				</span>
				{mood === "studying" ? (
					<span className={`mt-0.5 block text-xs ${T.muted}`}>{HINT}</span>
				) : null}
			</span>
		</div>
	);
}
