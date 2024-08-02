import { type Plugin } from '@cpn-console/hooks'
import infos from './infos.js'
import { deleteProject, upsertProject } from './function.js'
import { requiredEnv } from '@cpn-console/shared'

export const plugin: Plugin = {
  infos,
  subscribedHooks: {
    upsertProject: {
      steps: {
        post: upsertProject,
      },
    },
    deleteProject: {
      steps: {
        main: deleteProject,
      },
    },
  },
  start: () => { requiredEnv('GRAFANA_URL') }, // to check is the variable is set, unless it crashes the app
}
