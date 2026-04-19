function escapeXmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function wrapXmlTag(
	tagName: string,
	content: string,
	attributes?: Record<string, string>,
): string {
	const trimmedContent = content.trim();
	if (!trimmedContent) return "";
	const renderedAttributes = attributes
		? Object.entries(attributes)
				.map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`)
				.join("")
		: "";
	return `<${tagName}${renderedAttributes}>\n${trimmedContent}\n</${tagName}>`;
}

export function wrapSystemReminder(type: string, content: string): string {
	return wrapXmlTag("system_reminder", content, { type });
}
