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
	return <Lobby gameType={gameType} />;
}
