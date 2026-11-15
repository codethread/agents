# User documentation

## Keep the reader's job in view

**README.md answers “How do I use this project?”** Cover installation, usage and user-facing configuration. Link to ordinary guides for longer user reference material rather than making the README carry every detail.

Put contributor testing, fixtures, dogfood setup and internal validation in engineering documentation. A user-facing diagnostic or verification step belongs with the user task it supports; internal regression tests do not become installation prerequisites merely because they exercise the product. A brief contributor link can make engineering material discoverable without importing its procedures.

Keep architecture, alternatives and migration instructions where they help the intended reader make a real decision. Give the current path first when readers can use it directly.

## Use examples to carry the contract

Choose a small example that answers a reader's question. Show the minimum meaningful input and, when useful, the observable result. Keep warnings and constraints that affect correct use beside the example; remove prose that merely recites its fields.

The examples below are illustrative, not commands or contracts to copy into an unrelated repository.

### Separate installation from internal testing

Assume a fictional package is installed with `npm install example-widget`; its maintainers also run fixture and dogfood checks.

**Before — README installation:**

> Install with `npm install example-widget`. We test installation against local fixture repositories. Create a dogfood checkout, run the fixture suite and inspect the generated lockfile to confirm the package works.

**After — README installation:**

```sh
npm install example-widget
```

Move the fixture setup, commands and expected lockfile assertions to the repository's engineering testing guide, preserving the details maintainers need. Link from the contributor entry point, not as an extra installation step. Replacing the paragraph with “Run the dogfood checks” would still fail the audience test.

### Show a payload, explain its consequence

Assume a fictional API accepts a label and returns a queued job; a worker starts it later.

**Before:**

> The create endpoint creates jobs. Jobs have labels supplied during creation. Creation returns an identifier and the state of the job. Jobs enter the queue before a worker starts them.

**After:**

```text
POST /jobs
{"label":"preview"}

202 Accepted
{"id":"job-123","state":"queued"}
```

> `queued` confirms acceptance, not execution. A worker must pick up the job before it runs.

## Acceptance checks

- Can a new user find the supported installation and first useful action without following contributor-only testing or dogfood steps?
- Does each README section support use of the project or provide a short route to the right guide?
- Do examples match the documented interface, with prerequisites and consequential behavior explained rather than left to inference?
- After moving engineering details, can contributors still find the necessary commands and expected results?
