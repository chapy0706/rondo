/**
 * 3問を終えたあとの czz の結果画面（本家の結果ページのキャラクター演出）。
 * 「おわる」で基盤へ結果を返す（reportResult は親の Czz が呼ぶ）。
 */

import type { PlayResult } from "@rondo/contracts";
import { resultCharacter } from "../presentation";
import { T } from "./theme";

export function SessionResult({
	result,
	onDone,
}: {
	result: PlayResult;
	onDone: () => void;
}) {
	const total = Number(result.details?.total ?? 0);
	const perfect = result.score >= total;
	return (
		<div className="flex flex-col items-center gap-6 py-10 text-center">
			<img
				src={resultCharacter(result.score, total)}
				alt={perfect ? "喜ぶキャラクター" : "くやしがるキャラクター"}
				width={160}
				height={160}
				className="size-40"
			/>
			<div className="flex flex-col gap-1">
				<p className="font-bold text-2xl">
					{total} 問中 {result.score} 問正解
				</p>
				<p className={`text-sm ${T.muted}`}>
					{perfect ? "ぜんぶ正解！すごい！" : "次はもっといけるよ"}
				</p>
			</div>
			<button
				type="button"
				onClick={onDone}
				className={`min-h-12 min-w-40 px-8 font-semibold ${T.radius} ${T.primary} active:opacity-80`}
			>
				おわる
			</button>
		</div>
	);
}
