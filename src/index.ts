import type { DeclareModuleGenerator, Plugin } from '@cpn-console/hooks'
import { requiredEnv } from '@cpn-console/shared'
import { deleteProject, ensureProjectRepository, upsertProject } from './function.js'
import infos from './infos.js'

export const plugin: Plugin = {
  infos,
  subscribedHooks: {
    upsertProject: {
      steps: {
        pre: ensureProjectRepository,
        main: upsertProject,
      },
    },
    deleteProject: {
      steps: {
        main: deleteProject,
      },
    },
  },
  start: () => { requiredEnv('GRAFANA_URL') && requiredEnv('DSO_OBSERVABILITY_CHART_VERSION') }, // to check is the variable is set, unless it crashes the app
}

declare module '@cpn-console/hooks' {
  interface Config extends DeclareModuleGenerator<typeof infos, 'global'> {}
  interface ProjectStore extends DeclareModuleGenerator<typeof infos, 'project'> {}
}
