/**
 * ゲーム画面に出す、参加中のルーム名（issue-58）。識別子は出さない。
 * 名前は来場者の自由な入力なので、React の標準の表示（文字として出す）のままにする。
 */

export function RoomNameLabel({ name }: { name: string }) {
	return (
		<p
			className="max-w-full truncate text-slate-400 text-sm"
			data-testid="room-name"
		>
			ルーム: <span className="text-white">{name}</span>
		</p>
	);
}
