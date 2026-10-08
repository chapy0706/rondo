/**
 * つながらないときの表示（issue-47）。
 *
 * 返事が届かない・つなぎ直しをすべて失敗した、のどちらでも同じ表示にする。原因は
 * 説明しすぎず、次に何をすればよいかを示す（もう一度・ロビーへ・ゲーム選択へ）。
 * ロビーの中や、ロビーのないゲームでは、onLobby を渡さずロビーへを出さない。
 */
export function ConnectionFailed({
	onRetry,
	onLobby,
	onSelect,
}: {
	onRetry: () => void;
	onLobby?: (() => void) | undefined;
	onSelect: () => void;
}) {
	return (
		<section
			className="flex w-full max-w-xs flex-col items-center gap-4 text-center"
			data-testid="connection-failed"
		>
			<p className="font-semibold text-lg text-white">つながりません</p>
			<p className="text-slate-400 text-sm">
				通信の状態を確かめて、もう一度試してください。
			</p>
			<button
				type="button"
				onClick={onRetry}
				className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition-transform active:scale-[0.98]"
			>
				もう一度
			</button>
			{onLobby !== undefined && (
				<button
					type="button"
					onClick={onLobby}
					className="w-full rounded-xl bg-slate-700 px-4 py-3 font-medium text-white transition-transform active:scale-[0.98]"
				>
					ロビーへ
				</button>
			)}
			<button
				type="button"
				onClick={onSelect}
				className="text-indigo-400 text-sm underline"
			>
				ゲーム選択へ
			</button>
		</section>
	);
}
