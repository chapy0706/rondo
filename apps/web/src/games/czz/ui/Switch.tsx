/**
 * オン・オフのスイッチ（本家の Radix Switch の見た目を、依存なしで再現したもの）。
 * タップしやすいよう、押せる範囲は高さ 44px を確保する。
 */
export function Switch({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
		>
			<span
				className={`inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
					checked
						? "border-sky-500 bg-sky-500"
						: "border-[var(--czz-border)] bg-[var(--czz-muted)]"
				}`}
			>
				<span
					className={`block size-5 rounded-full border border-[var(--czz-border)] bg-[var(--czz-card)] shadow-md transition-transform ${
						checked ? "translate-x-5" : "translate-x-0"
					}`}
				/>
			</span>
		</button>
	);
}
