import { notFound } from "next/navigation";
import { findManifest } from "../../../games/registry";
import { PlayHost } from "../../../platform/host/PlayHost";

/**
 * ゲームホスト。選択画面で選ばれたゲームを起動する導線（ADR 0003）。
 *
 * registry から id でマニフェストを引き、汎用ホスト（PlayHost）に渡す。基盤は個々の
 * ゲームの中身を知らず、registry を通してマニフェストと本体ローダだけを読む。未登録の
 * id は 404 とする。ゲーム本体の描画・起動・結果受け取りは PlayHost が担う。
 */
export default async function PlayPage({
	params,
}: {
	params: Promise<{ gameId: string }>;
}) {
	const { gameId } = await params;
	const manifest = findManifest(gameId);

	if (manifest === undefined) {
		notFound();
	}

	return <PlayHost manifest={manifest} />;
}
