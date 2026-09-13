(require '[millstrand.api.current.alpha :as current]
         '[millstrand.api.runtime.alpha :as runtime]
         '[ct.spools.codethread.bootstrap :as codethread])

(def runtime (current/runtime))

;; Batteries supplies the common strand commands used by this workspace.
(runtime/module! runtime :millstrand/spools-batteries
                 {:ns 'millstrand.spools.batteries
                  :required? true})

;; Keep the workspace-owned help election and module behavior unchanged.
(runtime/module! runtime :module-me-help
                 {:file "me/help.clj"
                  :after [:millstrand/spools-batteries]})

;; The shared bootstrap owns Harnesses identity, Workflow, providers, aliases,
;; reviewers, and the asynchronous Workflow :agent executor.
(codethread/register! runtime)

;; Workspace-level Workflow and Kanban surfaces remain explicit consumer
;; choices; no provider, alias, reviewer, or executor lists are copied here.
(runtime/module! runtime :millhouse/spools-workflow-providers
                 {:ns 'millhouse.spools.workflow.spool
                  :after [:millhouse/spools-workflow]
                  :required? true})
(runtime/module! runtime :devflow
                 {:ns 'ct.spools.devflow
                  :after [:millhouse/spools-workflow]
                  :required? true})
(runtime/module! runtime :millhouse/spools-kanban
                 {:ns 'millhouse.spools.kanban
                  :required? true})
