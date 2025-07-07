import type { Environment, PluginResult, Project, StepCall, UserObject } from '@cpn-console/hooks'
import type { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import { parseError, specificallyDisabled } from '@cpn-console/hooks'
import { compressUUID } from '@cpn-console/shared'
import { deleteKeycloakGroup, ensureKeycloakGroups } from './keycloak.js'
import { type EnvType, type ObservabilityProject, ObservabilityRepoManager } from './observability-repo-manager.js'

const okSkipped: PluginResult = {
  status: {
    result: 'OK',
    message: 'Plugin disabled',
  },
}

export type ListPerms = Record<'prod' | 'hors-prod', Record<'view' | 'edit', UserObject['id'][]>>

const re = /[a-z0-9]{25}--[a-z0-9]{25}/
function isNewNsName(ns: string) {
  return re.test(ns)
}

function getListPerms(environments: Environment[]): ListPerms {
  const allProdPerms = environments
    .filter(env => env.stage === 'prod')
    .map(env => env.permissions)
    .flat()
  const allHProdPerms = environments
    .filter(env => env.stage !== 'prod')
    .map(env => env.permissions)
    .flat()

  const listPerms: ListPerms = {
    'hors-prod': {
      edit: [],
      view: [],
    },
    prod: {
      edit: [],
      view: [],
    },
  }
  for (const permission of allProdPerms) {
    if (permission.permissions.rw && !listPerms.prod.edit.includes(permission.userId)) {
      listPerms.prod.edit.push(permission.userId)
    }
    if (permission.permissions.ro && !listPerms.prod.view.includes(permission.userId)) {
      listPerms.prod.view.push(permission.userId)
    }
  }
  for (const permission of allHProdPerms) {
    if (permission.permissions.rw && !listPerms['hors-prod'].edit.includes(permission.userId)) {
      listPerms['hors-prod'].edit.push(permission.userId)
    }
    if (permission.permissions.ro && !listPerms['hors-prod'].view.includes(permission.userId)) {
      listPerms['hors-prod'].view.push(permission.userId)
    }
  }
  return listPerms
}

export const upsertProject: StepCall<Project> = async (payload) => {
  try {
    if (specificallyDisabled(payload.config.observability?.enabled)) {
      return okSkipped
    }
    // init args
    const project = payload.args
    const keycloakApi = payload.apis.keycloak as KeycloakProjectApi

    const keycloakRootGroupPath = await keycloakApi.getProjectGroupPath()
    const tenantRbacProd = [`${keycloakRootGroupPath}/grafana/prod-RW`, `${keycloakRootGroupPath}/grafana/prod-RO`]
    const tenantRbacHProd = [`${keycloakRootGroupPath}/grafana/hprod-RW`, `${keycloakRootGroupPath}/grafana/hprod-RO`]

    const compressedUUID = compressUUID(project.id)

    const projectValue: ObservabilityProject = {
      projectName: project.slug,
      envs: {
        hprod: {
          groups: tenantRbacHProd,
          tenants: {},
        },
        prod: {
          groups: tenantRbacProd,
          tenants: {},
        },
      },
    }

    for (const environment of payload.args.environments) {
      if (!environment.apis.kubernetes) {
        throw new Error(`no kubernetes apis on environment ${environment.name}`)
      }
      const namespace = await environment.apis.kubernetes.getNsName()
      const name = isNewNsName(namespace) ? compressedUUID : project.slug
      console.log({ namespace, name })
      const env: EnvType = environment.stage === 'prod' ? 'prod' : 'hprod'
      projectValue.envs[env].tenants[`${env}-${name}`] = {}
    }

    if (projectValue.envs.hprod && !Object.values(projectValue.envs.hprod.tenants).length) {
      // @ts-ignore
      delete projectValue.envs.hprod
    }
    if (projectValue.envs.prod && !Object.values(projectValue.envs.prod?.tenants).length) {
      // @ts-ignore
      delete projectValue.envs.prod
    }

    const listPerms = getListPerms(project.environments)

    // Upsert or delete Gitlab config based on prod/non-prod environment
    const observabilityRepoManager = new ObservabilityRepoManager()
    const yamlResult = await observabilityRepoManager.updateProjectConfig(project, projectValue)

    await ensureKeycloakGroups(listPerms, keycloakApi)

    return {
      status: {
        result: 'OK',
        message: yamlResult,
      },
      store: {
        instances: Object.keys(projectValue.envs).join(','),
      },
    }
  } catch (error) {
    return {
      status: {
        result: 'KO',
        message: 'An error happened while creating Observability resources',
      },
      error: parseError(error),
    }
  }
}

export const deleteProject: StepCall<Project> = async (payload) => {
  try {
    if (specificallyDisabled(payload.config.observability?.enabled)) {
      return okSkipped
    }
    const project = payload.args
    const keycloakApi = payload.apis.keycloak as KeycloakProjectApi
    const observabilityRepoManager = new ObservabilityRepoManager()

    await Promise.all([
      deleteKeycloakGroup(keycloakApi),
      observabilityRepoManager.deleteProjectConfig(project),
    ])

    return {
      status: {
        result: 'OK',
        message: 'Deleted',
      },
    }
  } catch (error) {
    return {
      status: {
        result: 'OK',
        message: 'An error happened while deleting resources',
      },
      error: JSON.stringify(error),
    }
  }
}
