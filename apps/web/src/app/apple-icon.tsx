import { ImageResponse } from "next/og";
import { rondoIconElement } from "../platform/brand/rondoIcon";

/** iPhone のホーム画面のアイコン（issue-69）。180 × 180 の PNG を、その場で作る。 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
	return new ImageResponse(rondoIconElement(180), size);
}
