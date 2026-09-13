(require '[millstrand.api.current.alpha :as current]
         '[millstrand.api.runtime.alpha :as runtime]
         '[ct.spools.codethread.bootstrap :as codethread])

(def runtime (current/runtime))

;; Batteries supplies the common strand commands used by this workspace.
(runtime/module! runtime :millstrand/spools-batteries
                 {:ns 'millstrand.spools.batteries
                  :required? true})

;; Register shared identity, Workflow, Harnesses, aliases, and reviewers before
;; any consumer modules. The bootstrap deliberately leaves the executor off
;; until all workspace-owned modules have reconciled.
(codethread/register! runtime)

;; Keep the workspace-level Workflow and Kanban CLI surfaces explicit consumer
;; choices; no provider, alias, reviewer, or executor definitions are copied
;; here.
(runtime/module! runtime :millhouse/spools-workflow-providers
                 {:ns 'millhouse.spools.workflow.spool
                  :after [:millhouse/spools-workflow]
                  :required? true})
(runtime/module! runtime :millhouse/spools-kanban
                 {:ns 'millhouse.spools.kanban
                  :required? true})

;; Keep the workspace-owned help election and module behavior unchanged.
(runtime/module! runtime :module-me-help
                 {:file "me/help.clj"
                  :after [:millstrand/spools-batteries]})

;; The shared bootstrap owns the sole :agent executor. It must be registered
;; last so restored ready gates see all consumer modules during its first scan.
(codethread/register-executor!
 runtime [:millhouse/spools-workflow-providers
          :millhouse/spools-kanban
          :module-me-help])
