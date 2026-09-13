# Millstrand migration manifest

This manifest accompanies the shared Harnesses/Codethread workspace migration.
It is handoff metadata for integrating the new `.millstrand` files into the
canonical `agents` checkout; it does not include runtime caches or state.

## New tracked configuration files

The following five files are the new tracked Millstrand configuration files:

```text
.millstrand/.gitignore
.millstrand/config.json
.millstrand/deps.edn
.millstrand/init.clj
.millstrand/me/help.clj
```

This manifest is an additional tracked handoff artifact. `.millstrand/config.local.json`
must remain untracked and must preserve the canonical JVM-pool overlay.

## Canonical pre-edit SHA-256

These hashes were captured read-only from `/Users/ct/dev/projects/agents/.millstrand`
before integration. Use them to detect drift before applying the files.

| Canonical file                                      | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `.millstrand/.gitignore`                            | `cabf06f0041472f9f7f412147e57f287a219c8ed4af1d4bec4e9c271f4bfbb53` |
| `.millstrand/config.json`                           | `55d77110951e10c64911636e11c341a2235d1549a43127f18bec68d3d5a09f21` |
| `.millstrand/deps.edn`                              | `6909d96e681a563866ddefa93cd578bbe623ffa6f65de36bec16b6c8cb5bdf87` |
| `.millstrand/init.clj`                              | `f619895ae5051274ecf1ab5a87c419740617c97208698cd3ab37de08c88fec62` |
| `.millstrand/me/help.clj`                           | `5ab059394c7eba645d9e1af618ded16883a3d75d06739a039866f69b961eb429` |
| `.millstrand/config.local.json` (untracked overlay) | `466b54122ccafc31e092dde2c94313bd5ae7969eedfe181515f524e39da9e40b` |

The canonical overlay is intentionally not copied into this commit. The
published `codethread/config` SHA remains unresolved until the shared source
worktree publishes its final commit; the current dependency pin is retained as
the coordinator follow-up point.
