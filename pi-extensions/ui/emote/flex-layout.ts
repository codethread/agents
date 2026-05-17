import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FlexTextLayoutOptions {
	width: number;
	rows: number;
	ellipsis?: string;
}

export function layoutFlexTextItems(items: string[], options: FlexTextLayoutOptions): string[] {
	const width = Math.max(0, options.width);
	const rows = Math.max(0, options.rows);
	const ellipsis = options.ellipsis ?? "$";
	if (width <= 0 || rows <= 0) return [];

	const groups = items.map((item) => [item]);
	while (groups.length > rows) {
		const last = groups.pop();
		if (!last) break;
		groups[groups.length - 1].push(...last);
	}

	return groups.map((group) => renderFlexTextRow(group, width, ellipsis));
}

function renderFlexTextRow(items: string[], width: number, ellipsis: string): string {
	if (items.length === 0) return "";
	if (items.length === 1) return truncateToWidth(items[0], width, ellipsis);

	const itemWidths = items.map(visibleWidth);
	const totalItemWidth = itemWidths.reduce((sum, itemWidth) => sum + itemWidth, 0);
	const gapCount = items.length - 1;
	if (totalItemWidth + gapCount <= width) {
		const totalGapWidth = width - totalItemWidth;
		const baseGap = Math.max(1, Math.floor(totalGapWidth / gapCount));
		let remainder = totalGapWidth - baseGap * gapCount;
		return items
			.map((item, index) => {
				if (index === items.length - 1) return item;
				const gapWidth = baseGap + (remainder > 0 ? 1 : 0);
				remainder -= 1;
				return item + " ".repeat(gapWidth);
			})
			.join("");
	}

	const availableItemWidth = Math.max(0, width - gapCount);
	const targetWidth = Math.max(1, Math.floor(availableItemWidth / items.length));
	let remainder = availableItemWidth - targetWidth * items.length;
	return items
		.map((item, index) => {
			const budget = targetWidth + (remainder > 0 ? 1 : 0);
			remainder -= 1;
			const rendered = truncateToWidth(item, budget, ellipsis);
			return index === items.length - 1 ? rendered : `${rendered} `;
		})
		.join("");
}
