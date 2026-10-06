import type { RealtimeResult } from "@rondo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultScreen } from "./ResultScreen";

function render(result: RealtimeResult): string {
	return renderToStaticMarkup(
		<ResultScreen result={result} you="p-1" onLeave={() => {}} />,
	);
}

describe("ResultScreen - 補助の表示（issue-42）", () => {
	it("details があれば、キーと値を並べて出す", () => {
		const html = render({
			order: "higher-is-better",
			rankings: [
				{
					playerId: "p-1",
					name: "user1",
					rank: 1,
					result: {
						score: 1,
						details: { 役割: "隠れる側", 結果: "勝ち", 状態: "逃げ切り" },
					},
				},
			],
		});
		expect(html).toContain("役割");
		expect(html).toContain("隠れる側");
		expect(html).toContain("逃げ切り");
	});

	it("details が無ければ、補助の欄を出さない（これまでの表示のまま）", () => {
		const html = render({
			order: "lower-is-better",
			rankings: [
				{ playerId: "p-1", name: "user1", rank: 1, result: { score: 12 } },
			],
		});
		expect(html).not.toContain("<dl");
		expect(html).toContain("1位");
		expect(html).toContain("user1");
	});
});
