/**
 * ルームを作れないとき（同時ルーム数の上限 / issue-60）に出す、ひとり用のゲームへの導線。登録の中の
 * ひとり用のゲーム（kind: solo）を並べ、押すと、そのゲームの画面へ移る。下に「ゲーム選択へ戻る」を出す。
 */

import type { GameManifest } from "@rondo/contracts";
import Link from "next/link";
import { playPathOf } from "../../games/registry";
import { GameLogo } from "../brand/GameLogo";
import { displayName } from "../brand/gameBrand";

/** 登録の中の、ひとり用のゲーム（登録の順）。 */
export function soloGames(manifests: readonly GameManifest[]): GameManifest[] {
	return manifests.filter((manifest) => manifest.kind === "solo");
}

export function SoloGameLinks({
	games,
}: {
	games: readonly GameManifest[];
}) {
	return (
		<div className="flex flex-col gap-3" data-testid="lobby-solo-games">
			<ul className="grid grid-cols-2 gap-3">
				{games.map((game) => (
					<li key={game.id}>
						<Link
							href={playPathOf(game.id)}
							data-game={game.id}
							className="flex items-center gap-3 rounded-xl bg-slate-800 px-3 py-2 text-sm text-white"
						>
							<GameLogo manifest={game} size={40} />
							<span className="min-w-0 truncate">{displayName(game)}</span>
						</Link>
					</li>
				))}
			</ul>
			<Link href="/select" className="text-indigo-400 text-sm underline">
				ゲーム選択へ戻る
			</Link>
		</div>
	);
}
