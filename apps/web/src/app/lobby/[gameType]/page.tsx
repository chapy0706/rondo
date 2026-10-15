import { findManifest } from "../../../games/registry";
import { Lobby } from "../../../platform/lobby/Lobby";

/**
 * ルーム・ロビーのルート。リアルタイムゲームの gameType ごとに一覧を出す（ADR 0016）。
 *
 * 基盤はゲームの中身を知らず、URL の gameType を多重化キー（ADR 0007）として
 * ロビーに渡すだけ。選択画面からロビーへ繋ぐ導線は issue-12 のゲーム入場で整える。
 */
export default async function LobbyPage({
	params,
}: {
	params: Promise<{ gameType: string }>;
}) {
	const { gameType } = await params;
	// ルーム作成時の選択肢はマニフェストの宣言から渡す（ロビーはゲームを知らない）。
	const manifest = findManifest(gameType);
	// 見出しの名前とロゴ（issue-69）も、マニフェストから渡す。
	return (
		<Lobby
			gameType={gameType}
			roomOptions={manifest?.roomOptions ?? []}
			{...(manifest === undefined ? {} : { manifest })}
		/>
	);
}
