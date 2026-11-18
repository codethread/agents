---
name: effect-v4
description: Use when implementing or reviewing Effect 4 code, especially services, custom loggers, Schema error formatting or platform imports. Corrects stale v3 and v4-beta assumptions.
---

# Effect 4 knowledge gaps

Verified against `effect` and `@effect/platform-bun` 4.0.6 on 2026-10-31.

## Resolve the version before the docs

V4 is stable, not the old effect-smol beta. The canonical repository is now
[Effect-TS/effect](https://github.com/Effect-TS/effect); effect-smol is archived.
Check the consuming package's installed version and exports. Migration guides on
`main` can be newer than the lockfile, and prose/examples can disagree with types.

## Services: Context, not ServiceMap

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

class Users extends Context.Service<
	Users,
	{
		readonly name: Effect.Effect<string>;
	}
>()("app/Users") {
	static readonly layer = Layer.succeed(Users, { name: Effect.succeed("Ada") });
}
```

`ServiceMap.Service` is stale beta knowledge. V3's `Effect.Service` auto-generated
`.Default` and dependency wiring are replaced by explicit layers.
See [services migration](https://github.com/Effect-TS/effect/blob/main/migration/services.md).

## Logger options no longer contain annotations

```ts
import * as Logger from "effect/Logger";
import * as References from "effect/References";

const logger = Logger.make(({ fiber, message, logLevel, date }) => {
	const annotations = fiber.getRef(References.CurrentLogAnnotations);
	console.log(JSON.stringify({ message, logLevel, date, ...annotations }));
});
const layer = Logger.layer([logger]);
```

Annotations are a readonly record, not a Map. `Logger.layer` replaces existing
loggers unless `mergeWithExisting: true`. Read annotation state from the fiber;
there is no `Logger.CurrentLogAnnotations` or `options.annotations`.

## Schema formatting: use the error you already have

`SchemaError.message` is human-readable. For structured paths/messages use
`SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues`, not a guessed
`SchemaFormatter` or v3 `ParseResult.TreeFormatter`. Decode with
`reportInput: false` when logging validation failures for secrets; custom messages
and paths remain your responsibility.

## Imports: stable release paths differ from beta examples

HTTP exports are under `effect/http`, not `@effect/platform` or
`effect/unstable/http`. Check `package.json` exports before copying beta snippets.
BunRuntime remains in `@effect/platform-bun`; pin it to the same Effect version.
`BunRuntime.runMain` handles signals and failure exit codes. In 4.0.6 its actual
options are `disableErrorReporting` and `teardown`; prose mentioning
`disablePrettyLogger` is stale.

## Error wrappers at foreign boundaries

The function-only `Effect.try` wraps thrown errors in `Cause.UnknownError`, so
serializing the failure loses the original error name/message. Use the object
form with an explicit `catch` mapping when a protocol must preserve that detail.
For logs at untrusted boundaries, `Cause.pretty` recursively renders nested causes;
`String(Cause.squash(cause))` preserves the former top-level-only error shape.

## References

| reference | path                    | use case                                                              |
| --------- | ----------------------- | --------------------------------------------------------------------- |
| linting   | ./references/linting.md | migrate repo tooling if using eslint of oxlint, only needed for setup |
