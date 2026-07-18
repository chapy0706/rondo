import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// このファイル（apps/web）の場所からモノレポのルートを求める（ADR 0011）。
const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	// Docker への配置を軽くするため、実行に必要な最小構成だけを出力する（issue-15）。
	// .next/standalone に server.js と辿った依存だけが入り、イメージを薄く保てる。
	output: "standalone",
	// pnpm ワークスペースのルートを基準に依存を辿る。workspace パッケージ
	// （@rondo/contracts, @rondo/game-sdk）も standalone に含める。
	outputFileTracingRoot: path.join(here, "..", ".."),
};

export default nextConfig;
