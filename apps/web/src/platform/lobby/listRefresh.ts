/**
 * ロビーの一覧の自動更新（issue-60）。LOBBY_REFRESH_MS ごとに一覧を頼む（空きが出たら、押せるようになる）。
 *
 * - 画面が見えない間は頼まない。見えるようになったら、すぐ 1 回頼む（通信を増やしすぎない）
 * - 参加・作成の返事を待っている間（busy）は頼まない
 * - 頼んだ返事が来なくても（失敗）、黙って次の回に回す（画面を壊さない。返事は待たない）
 *
 * 時計と可視状態は差し替えられる（テストでは偽物を渡す / useRealtimeLobby.ts が本物を渡す）。
 */

/** 自動更新の間隔（ミリ秒）。 */
export const LOBBY_REFRESH_MS = 5000;

export interface RefreshDeps {
	/** 一覧を頼む（list-rooms を送る）。 */
	request(): void;
	/** 画面が見えているか。 */
	visible(): boolean;
	/** 参加・作成の返事を待っているか。 */
	busy(): boolean;
	/** 可視状態が変わったら cb を呼ぶ。返り値は見張りの解除。 */
	onVisibilityChange(cb: () => void): () => void;
	/** ms ごとに cb を呼ぶ。返り値は止める関数。 */
	every(cb: () => void, ms: number): () => void;
}

/** 自動更新を始める。返り値で止める。 */
export function startListRefresh(deps: RefreshDeps): () => void {
	const maybe = () => {
		if (deps.visible() && !deps.busy()) deps.request();
	};
	const stopTimer = deps.every(maybe, LOBBY_REFRESH_MS);
	const stopWatching = deps.onVisibilityChange(() => {
		if (deps.visible()) maybe();
	});
	return () => {
		stopTimer();
		stopWatching();
	};
}

/** ブラウザの本物（document.visibilityState と setInterval）。 */
export function browserRefreshDeps(
	request: () => void,
	busy: () => boolean,
): RefreshDeps {
	return {
		request,
		busy,
		visible: () => document.visibilityState === "visible",
		onVisibilityChange: (cb) => {
			document.addEventListener("visibilitychange", cb);
			return () => document.removeEventListener("visibilitychange", cb);
		},
		every: (cb, ms) => {
			const timer = window.setInterval(cb, ms);
			return () => window.clearInterval(timer);
		},
	};
}
