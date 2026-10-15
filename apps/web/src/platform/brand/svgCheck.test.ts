import { describe, expect, it } from "vitest";
import { checkLogoSvg } from "./svgCheck";

const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#26315c"/>
<circle cx="256" cy="256" r="40" fill="#ffffff"/>
</svg>`;

describe("checkLogoSvg - ロゴの SVG の決まり（issue-69）", () => {
	it("決まりどおりなら、問題なし", () => {
		expect(checkLogoSvg(good, "#26315c")).toEqual([]);
	});

	it("viewBox が 0 0 512 512 でなければ、問題", () => {
		expect(
			checkLogoSvg(good.replace("0 0 512 512", "0 0 100 100"), "#26315c"),
		).toContain("viewBox が 0 0 512 512 でない");
	});

	it("20 KB を超えれば、問題", () => {
		const big = good.replace("</svg>", `<!--${"x".repeat(21_000)}--></svg>`);
		expect(checkLogoSvg(big, "#26315c")).toContain("20 KB を超えている");
	});

	it("文字（text・tspan・font）を含めば、問題", () => {
		expect(
			checkLogoSvg(good.replace("</svg>", "<text>あ</text></svg>"), "#26315c"),
		).toContain("文字を含む");
		expect(
			checkLogoSvg(
				good.replace("<circle", '<circle font-family="serif"'),
				"#26315c",
			),
		).toContain("文字を含む");
	});

	it("最初の図形が、登録の背景の色で全面を塗る四角でなければ、問題", () => {
		expect(checkLogoSvg(good, "#3f8f5a")).toContain(
			"背景を登録の色（#3f8f5a）で全面に塗っていない",
		);
		expect(
			checkLogoSvg(good.replace('width="512"', 'width="500"'), "#26315c"),
		).toContain("背景を登録の色（#26315c）で全面に塗っていない");
	});

	it("線（stroke）・外の画像・スクリプトを使えば、問題", () => {
		expect(
			checkLogoSvg(good.replace("<circle", '<circle stroke="#fff"'), "#26315c"),
		).toContain("線（stroke）を使っている");
		expect(
			checkLogoSvg(
				good.replace("</svg>", '<image href="x.png"/></svg>'),
				"#26315c",
			),
		).toContain("画像・外の参照・スクリプトを含む");
		expect(
			checkLogoSvg(
				good.replace("</svg>", "<script>1</script></svg>"),
				"#26315c",
			),
		).toContain("画像・外の参照・スクリプトを含む");
	});

	it("色は #rrggbb で書き、背景を含めて 5 色まで（平らな図形・差し色1色）", () => {
		const extra = ["#111111", "#222222", "#333333", "#444444", "#555555"]
			.map((c, i) => `<rect x="${i}" y="0" width="1" height="1" fill="${c}"/>`)
			.join("");
		const many = good.replace("</svg>", `${extra}</svg>`);
		expect(checkLogoSvg(many, "#26315c")).toContain("色が多い（5 色まで）");
		expect(
			checkLogoSvg(good.replace('fill="#ffffff"', 'fill="white"'), "#26315c"),
		).toContain("色を #rrggbb 以外で書いている");
	});
});
