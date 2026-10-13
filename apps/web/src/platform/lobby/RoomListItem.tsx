/**
 * ロビーのルーム一覧の1行（issue-58）。名前・人数・状態を出し、識別子は出さない。
 * 名前は来場者の自由な入力なので、React の標準の表示（文字として出す）のままにする。
 */

import type { RoomSummary } from "@rondo/contracts";
import { roomListLabel } from "./roomName";

export function RoomListItem({
	room,
	disabled,
	onJoin,
}: {
	room: RoomSummary;
	disabled: boolean;
	onJoin: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onJoin}
			disabled={disabled}
			className="flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-800 px-4 py-3 text-left transition-transform active:scale-[0.98] disabled:opacity-50"
		>
			<span className="min-w-0 truncate font-medium text-white">
				{roomListLabel(room)}
			</span>
			<span className="shrink-0 text-slate-400 text-sm">
				{room.playerCount}/{room.capacity}
				{room.status === "playing" ? " ・進行中" : " ・待機中"}
			</span>
		</button>
	);
}
