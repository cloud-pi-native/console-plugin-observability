import type { Environment, PluginResult, Project, StepCall, UserObject } from '@cpn-console/hooks'
import type { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import type { Gitlab as GitlabInterface } from '@gitbeaker/core'
import { parseError, specificallyDisabled } from '@cpn-console/hooks'
import { compressUUID, removeTrailingSlash, requiredEnv } from '@cpn-console/shared'
import { Gitlab } from '@gitbeaker/rest'
import { deleteKeycloakGroup, ensureKeycloakGroups } from './keycloak.js'
import { isNewNsName } from './utils.js'
import { deleteGitlabYamlConfig, type ProjectLoki, type Type, upsertGitlabConfig } from './yaml.js'

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

    const projectValue: ProjectLoki = {
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
      const env: Type = environment.stage === 'prod' ? 'prod' : 'hprod'
      projectValue.envs[env].tenants[`${env}-${name}`] = {}
    }

    if (projectValue.envs.hprod && !Object.values(projectValue.envs.hprod?.tenants).length) {
      // @ts-ignore
      delete projectValue.envs.hprod
    }
    if (projectValue.envs.prod && !Object.values(projectValue.envs.prod?.tenants).length) {
      // @ts-ignore
      delete projectValue.envs.prod
    }

    const listPerms = getListPrems(project.environments)

    // Upsert or delete Gitlab config based on prod/non-prod environment
    const yamlResult = await upsertGitlabConfig(project, gitlabApi, projectValue)
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
