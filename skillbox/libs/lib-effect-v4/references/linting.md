## Misuse linting on TypeScript 7

ESLint (typescript-eslint `strict-type-checked`) is the only linter; Oxlint and the
`@effect/tsgo` Oxlint integration were removed. The official `@effect/eslint-plugin` supplies
`no-import-from-barrel-package` (its `dprint` rule is unused; Oxfmt formats), and
`eslint-plugin-effect-doctor` supplies Effect 4 misuse rules. Prefer published
Effect rules over new local ones and check them before adding any. The native `effecttsgo` diagnostics are not
available to ESLint, so Effect misuse is covered by local rules in `tooling/eslint`:
floating Effects, `yield` without `*`, `any`/`unknown` error or requirement channels, and
Effects returned from Bun test callbacks. Other `effecttsgo` checks are not enforced.

Keep await-thenable enabled: awaiting an Effect does not run it. The ESLint checker
uses JS TypeScript 6 (`typescript`); application checks use the explicit native
TypeScript 7 alias (`typescript-native`). Run project scripts rather than bare
`tsc`, whose binary link can resolve to either compiler.

For a broader migration, consult the [migration index](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
rather than expanding this delta into a v3 tutorial.
