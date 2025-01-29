import type { Environment, PluginResult, Project, StepCall, UserObject } from '@cpn-console/hooks'
import type { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import type { Gitlab as GitlabInterface } from '@gitbeaker/core'
import { parseError, specificallyDisabled } from '@cpn-console/hooks'
import { compressUUID, removeTrailingSlash, requiredEnv } from '@cpn-console/shared'
import { Gitlab } from '@gitbeaker/rest'
import { deleteKeycloakGroup, ensureKeycloakGroups } from './keycloak.js'
import { isNewNsName, type TenantKeycloakMapper } from './utils.js'
import { deleteGitlabYamlConfig, upsertGitlabConfig } from './yaml.js'

const okSkipped: PluginResult = {
  status: {
    result: 'OK',
    message: 'Plugin disabled',
  },
}

export type ListPerms = Record<'prod' | 'hors-prod', Record<'view' | 'edit', UserObject['id'][]>>

function getListPrems(environments: Environment[]): ListPerms {
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

function getGitlabApi(): GitlabInterface {
  const gitlabUrl = removeTrailingSlash(requiredEnv('GITLAB_URL'))
  const gitlabToken = requiredEnv('GITLAB_TOKEN')
  return new Gitlab({ token: gitlabToken, host: gitlabUrl })
}

export const upsertProject: StepCall<Project> = async (payload) => {
  try {
    if (specificallyDisabled(payload.config.observability?.enabled)) {
      return okSkipped
    }
    // init args
    const project = payload.args
    const keycloakApi = payload.apis.keycloak as KeycloakProjectApi
    // init gitlab api
    const gitlabApi = getGitlabApi()
    const keycloakRootGroupPath = await keycloakApi.getProjectGroupPath()
    const tenantRbacProd = [`${keycloakRootGroupPath}/grafana/prod-RW`, `${keycloakRootGroupPath}/grafana/prod-RO`]
    const tenantRbacHProd = [`${keycloakRootGroupPath}/grafana/hprod-RW`, `${keycloakRootGroupPath}/grafana/hprod-RO`]

    const compressedUUID = compressUUID(project.id)

    const tenantsToCreate: TenantKeycloakMapper = {}

    for (const environment of payload.args.environments) {
      if (!environment.apis.kubernetes) {
        throw new Error(`no kubernetes apis on environment ${environment.name}`)
      }
      const gen = isNewNsName(await environment.apis.kubernetes.getNsName()) ? compressedUUID : project.slug
      if (environment.stage === 'prod') {
        tenantsToCreate[`prod-${gen}`] = tenantRbacProd
      } else {
        tenantsToCreate[`hprod-${gen}`] = tenantRbacHProd
      }
    }

    const listPerms = getListPrems(project.environments)

    const [_, yamlResult] = await Promise.all([
      ensureKeycloakGroups(listPerms, keycloakApi),
      // Upsert or delete Gitlab config based on prod/non-prod environment
      upsertGitlabConfig(project, gitlabApi, tenantsToCreate),
    ])

    return {
      status: {
        result: 'OK',
        message: yamlResult,
      },
    }
  } catch (error) {
    return {
      status: {
        result: 'KO',
        message: 'An error happened while creating Kibana resources',
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
    const gitlabApi = getGitlabApi()
    const keycloakApi = payload.apis.keycloak as KeycloakProjectApi

    await Promise.all([
      deleteKeycloakGroup(keycloakApi),
      deleteGitlabYamlConfig(project, gitlabApi),
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
