/**
 * 3D ではない画面の見た目の比較（issue-52）。前回の基準画像との差分を見つける。
 *
 * - 比べる画面: 選択画面、ロビー、つながらないときの失敗の表示（ロビー）。結果画面は、そこまでの
 *   流れが長いので、result.e2e.ts（@result）で比べる
 * - 許容の範囲: 画素の 1% まで（playwright.extended.config.ts の toHaveScreenshot.maxDiffPixelRatio）。
 *   毎回変わる所（ルームの一覧）は、撮るときだけ畳む。アニメーションは止める。開発サーバーの道具のボタンは、
 *   撮るときの CSS（tests/screenshot.css）で消す
 * - 基準画像は、端末設定ごと・OS ごとに、tests/extended/visual.e2e.ts-snapshots/ に置く。素材の映る
 *   画面（平屋、キャラクター）は比べない。画面を変えたときは、--update-snapshots で作り直して、
 *   差分を目で確かめてからコミットする
 */

import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { test } from "../flows";

test("選択画面", async ({ openTab }) => {
	const a = await openTab();
	await a.page.goto("/select");
	await expect(
		a.page.getByRole("link", { name: "veryare", exact: true }),
	).toBeVisible();
	await expect(a.page).toHaveScreenshot("select.png", { fullPage: true });
});

test("ロビー（ルームの一覧は畳む）", async ({ openTab }) => {
	const a = await openTab();
	await a.page.goto("/lobby/veryare");
	const list = a.page.getByRole("heading", { name: "ルーム一覧" });
	await expect(list).toBeVisible();
	// ルームの一覧は、前のテストのルームが残っていると高さが変わる（覆うだけでは下がずれる）。
	// 撮るときだけ、一覧の中身を畳んで比べない。
	await expect(a.page).toHaveScreenshot("lobby.png", {
		fullPage: true,
		// この呼び出しの stylePath は、設定の stylePath を置き換えるので、両方を渡す。
		stylePath: [
			fileURLToPath(new URL("../screenshot.css", import.meta.url)),
			fileURLToPath(new URL("./lobby-screenshot.css", import.meta.url)),
		],
	});
});

test("つながらないときの失敗の表示（ロビー）", async ({ openTab }) => {
	const a = await openTab();
	await a.link.goOffline();
	await a.page.goto("/lobby/veryare");
	// 遮断したまま、ルームを作る。返事が無いまま約 10 秒で、失敗の表示に移る（issue-47）。
	await a.page.getByRole("button", { name: "新しいルームを作る" }).click();
	await expect(a.page.getByTestId("connection-failed")).toBeVisible({
		timeout: 20_000,
	});
	await expect(a.page).toHaveScreenshot("connection-failed.png", {
		fullPage: true,
	});
});
