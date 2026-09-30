import { defineConfig } from "vitest/config";

/**
 * テスト実行時の設定。
 *
 * tsconfig の jsx は Next.js 向けに "preserve" なので、テストで JSX を描画できるよう
 * ここでだけ自動ランタイム（react/jsx-runtime）で変換する。Next.js のビルドには関係しない。
 */
export default defineConfig({
	esbuild: {
		jsx: "automatic",
	},
});
