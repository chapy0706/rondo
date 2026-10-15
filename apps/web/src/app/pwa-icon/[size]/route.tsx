import { ImageResponse } from "next/og";
import {
	PWA_ICON_SIZES,
	isPwaIconSize,
	rondoIconElement,
} from "../../../platform/brand/rondoIcon";

/**
 * Web App Manifest のアイコン（issue-69）。192・512 の PNG を作る（ビルドのときに作っておく）。
 * それ以外の大きさは 404。
 */
export const dynamicParams = false;

export function generateStaticParams() {
	return PWA_ICON_SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ size: string }> },
) {
	const { size } = await params;
	if (!isPwaIconSize(size)) return new Response("Not Found", { status: 404 });
	const px = Number(size);
	return new ImageResponse(rondoIconElement(px), { width: px, height: px });
}
