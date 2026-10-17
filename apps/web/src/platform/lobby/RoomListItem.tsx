/**
 * ロビーのルーム一覧の1行（issue-58）。名前・人数・状態（待機中・満員・プレイ中 / issue-60）を出し、識別子は
 * 出さない。参加できない状態（満員・プレイ中）と、disabled（返事を待っている間）のときは押せない。
 * 名前は来場者の自由な入力なので、React の標準の表示（文字として出す）のままにする。
 */

import type { RoomSummary } from "@rondo/contracts";
import { availabilityLabel, roomAvailability } from "./roomAvailability";
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
	const availability = roomAvailability(room);
	return (
		<button
			type="button"
			// E2E は、文言ではなく、この属性で探す（名前は来場者の入力。属性の値として持つだけ）。
			data-testid="lobby-room"
			data-room-name={room.name}
			data-availability={availability}
			onClick={onJoin}
			disabled={disabled || availability !== "open"}
			className="flex w-full items-center justify-between gap-3 rounded-2xl bg-slate-800 px-4 py-3 text-left transition-transform active:scale-[0.98] disabled:opacity-50"
		>
			<span className="min-w-0 truncate font-medium text-white">
				{roomListLabel(room)}
			</span>
			<span className="shrink-0 text-slate-400 text-sm">
				{room.playerCount}/{room.capacity}
				{` ・${availabilityLabel(availability)}`}
			</span>
		</button>
	);
}
