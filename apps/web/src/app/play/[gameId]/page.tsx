import Link from "next/link";
import { notFound } from "next/navigation";
import { findManifest } from "../../../games/registry";

/**
 * ゲームホスト。選択画面で選ばれたゲームを起動する導線（ADR 0003）。
 *
 * registry から id でマニフェストを引き、選ばれたゲームを受け取る。基盤は個々の
 * ゲームの中身を知らず、registry を通してマニフェストだけを読む。未登録の id は
 * 404 とする。ゲーム本体の描画・起動は各ゲーム（issue-07 以降）で差し込む。
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

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-6 py-16">
			<h1 className="font-bold text-3xl text-white">{manifest.title}</h1>
			<p className="text-slate-400">
				ゲーム本体はこのホストに差し込まれる（issue-07 以降）。
			</p>
			<Link href="/select" className="text-indigo-400 underline">
				ゲーム選択へ戻る
			</Link>
		</main>
	);
}
