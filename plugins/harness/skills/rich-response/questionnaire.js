/* global document */
(() => {
	const config = JSON.parse(document.getElementById("questionnaire-config").textContent);
	const form = document.querySelector("form.questionnaire");
	const submit = document.createElement("button");
	submit.type = "submit";
	submit.textContent = "Submit answers";
	const status = document.createElement("p");
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	form.append(submit, status);
	for (const question of config.questions) {
		if (question.required && question.kind !== "checkbox") {
			form.querySelector(`[name="${question.name}"]`).required = true;
		}
	}
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const data = new FormData(form);
		const values = {};
		for (const question of config.questions) {
			values[question.name] =
				question.kind === "checkbox" ? data.getAll(question.name) : data.get(question.name) || "";
			if (question.notes) values[question.notes] = data.get(question.notes) || "";
			if (question.required && !values[question.name].length) {
				status.textContent = `Please answer: ${question.question}`;
				form.querySelector(`[name="${question.name}"]`).focus();
				return;
			}
		}
		submit.disabled = true;
		status.textContent = "Saving your answers…";
		try {
			const response = await fetch(config.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(values),
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error);
			status.textContent = "Answers saved. You can return to the conversation.";
			for (const control of form.querySelectorAll("input, textarea, button"))
				control.disabled = true;
		} catch (error) {
			status.textContent = `Could not confirm saving: ${error.message}. Your choices are still here; try Submit again.`;
			submit.disabled = false;
		}
	});
})();
