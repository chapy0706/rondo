import { describe, expect, it } from "vitest";
import fixture from "./fixtures/messages.json";
import { clientMessageSamples, serverMessageSamples } from "./messageSamples";
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from "./messageTypes";

describe("契約の見本（TS の型・JSON・Gleam の対応 / ADR 0009）", () => {
	it("JSON の見本は、TS の型で書いた見本と一致する", () => {
		expect(fixture).toEqual(
			JSON.parse(
				JSON.stringify({
					client: clientMessageSamples,
					server: serverMessageSamples,
				}),
			),
		);
	});

	it("クライアント→サーバーの全種別に見本がある", () => {
		const types = new Set(clientMessageSamples.map((m) => m.type));
		expect([...types].sort()).toEqual([...CLIENT_MESSAGE_TYPES].sort());
	});

	it("サーバー→クライアントの全種別に見本がある", () => {
		const types = new Set(serverMessageSamples.map((m) => m.type));
		expect([...types].sort()).toEqual([...SERVER_MESSAGE_TYPES].sort());
	});
});
