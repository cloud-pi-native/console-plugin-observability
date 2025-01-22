import type { Environment, Project, StepCall, UserObject } from '@cpn-console/hooks'
import type { Gitlab as GitlabInterface } from '@gitbeaker/core'
import type { BaseParams, Stage } from './utils.js'
import { parseError } from '@cpn-console/hooks'
import { removeTrailingSlash, requiredEnv } from '@cpn-console/shared'
import { Gitlab } from '@gitbeaker/rest'
import { deleteKeycloakGroup, ensureKeycloakGroups } from './keycloak.js'
import { deleteGitlabYamlConfig, upsertGitlabConfig } from './yaml.js'

const getBaseParams = (project: Project, stage: Stage): BaseParams => ({ organizationName: project.organization.name, projectName: project.name, stage })

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
    // init args
    const project = payload.args
    const keycloakApi = payload.apis.keycloak
    const vaultApi = payload.apis.vault
    // init gitlab api
    const gitlabApi = getGitlabApi()
    const keycloakRootGroupPath = await keycloakApi.getProjectGroupPath()

    const hasProd = project.environments.find(env => env.stage === 'prod')
    const hasNonProd = project.environments.find(env => env.stage !== 'prod')
    const hProdParams = getBaseParams(project, 'hprod')
    const prodParams = getBaseParams(project, 'prod')
    const listPerms = getListPrems(project.environments)

    await Promise.all([
      ensureKeycloakGroups(listPerms, keycloakApi),
      // Upsert or delete Gitlab config based on prod/non-prod environment
      ...(hasProd
        ? [await upsertGitlabConfig(prodParams, keycloakRootGroupPath, project, gitlabApi, vaultApi)]
        : [await deleteGitlabYamlConfig(prodParams, project, gitlabApi)]),
      ...(hasNonProd
        ? [await upsertGitlabConfig(hProdParams, keycloakRootGroupPath, project, gitlabApi, vaultApi)]
        : [await deleteGitlabYamlConfig(hProdParams, project, gitlabApi)]),
    ])

    return {
      status: {
        result: 'OK',
        message: 'Created',
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
    const project = payload.args
    const gitlabApi = getGitlabApi()
    const keycloakApi = payload.apis.keycloak
    const hProdParams = getBaseParams(project, 'hprod')
    const prodParams = getBaseParams(project, 'prod')

    await Promise.all([
      deleteKeycloakGroup(keycloakApi),
      deleteGitlabYamlConfig(prodParams, project, gitlabApi),
      deleteGitlabYamlConfig(hProdParams, project, gitlabApi),
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
