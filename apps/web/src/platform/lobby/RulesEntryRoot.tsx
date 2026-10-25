"use client";

/**
 * 新しい規則の選択肢の入口（URL の ?rules=1 / rulesEntry.ts）を、どのページでも読む部品。ルートの layout に
 * 1 つ置く。TOP や選択画面を ?rules=1 で開いてから、URL に何も付けずにロビーへ移っても、選択肢が出るように、
 * 開いたページの URL を、その場で端末に覚える（?rules=0 なら解除）。描くものは無い。
 *
 * ロビーも、開いたときに自分の URL を読む（Lobby.tsx）。ここは、ロビーの外の URL を覚えるためだけにある。
 */

import { useEffect } from "react";
import { rulesEntryOn, rulesStorage } from "./rulesEntry";

export function RulesEntryRoot(): null {
	useEffect(() => {
		rulesEntryOn(window.location.search, rulesStorage());
	}, []);
	return null;
}
