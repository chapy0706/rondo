/**
 * veryare のクライアントが送るゲーム内イベントの見本（issue-27 / ADR 0009）。
 *
 * TS の型で書いた見本を、fixtures/veryare-events.json の valid と一致させる
 * （veryareEventSamples.test.ts）。Gleam 側は同じ JSON を読み、サーバーの decoder が
 * valid を受け付け、invalid を拒むことを確かめる
 * （server/test/rondo_server/games/veryare/shoot_fixture_test.gleam）。
 */

import type { VeryareShootEvent } from "./veryare";

export const shootEventSamples = [
	{ type: "shoot", target: "p-2" },
	{ type: "shoot", target: null },
] satisfies VeryareShootEvent[];
