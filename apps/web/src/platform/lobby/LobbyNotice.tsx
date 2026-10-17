/**
 * ロビーの案内の枠（issue-60）。サーバーのエラーの種類から決めた文言（serverErrors.ts）と、次の行動の
 * ボタンを出す。サーバーの文（message）は出さない。ルームを作れないとき（room-limit）は、ひとり用の
 * ゲームの一覧も出す。
 */

import { registry } from "../../games/registry";
import type { ErrorNotice } from "../session/serverErrors";
import { SoloGameLinks, soloGames } from "./soloGames";

const BUTTON =
	"rounded-xl bg-slate-700 px-4 py-2 font-medium text-sm text-white transition-transform active:scale-[0.98]";

export function LobbyNotice({
	notice,
	onRefresh,
	onReload,
	onRetry,
}: {
	notice: ErrorNotice;
	onRefresh: () => void;
	onReload: () => void;
	onRetry: () => void;
}) {
	const has = (action: ErrorNotice["actions"][number]) =>
		notice.actions.includes(action);
	return (
		<section
			className="flex flex-col gap-3 rounded-xl bg-red-950 px-4 py-3"
			data-testid="lobby-notice"
			data-code={notice.code}
		>
			<p className="text-red-100 text-sm">{notice.text}</p>
			{has("solo") ? <SoloGameLinks games={soloGames(registry)} /> : null}
			{has("refresh") || has("reload") || has("retry") ? (
				<div className="flex flex-wrap gap-2">
					{has("refresh") ? (
						<button type="button" onClick={onRefresh} className={BUTTON}>
							一覧を更新
						</button>
					) : null}
					{has("reload") ? (
						<button type="button" onClick={onReload} className={BUTTON}>
							読み込み直す
						</button>
					) : null}
					{has("retry") ? (
						<button type="button" onClick={onRetry} className={BUTTON}>
							もう一度
						</button>
					) : null}
				</div>
			) : null}
		</section>
	);
}
