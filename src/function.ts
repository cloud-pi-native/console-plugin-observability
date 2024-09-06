import { Environment, parseError, UserObject, type Project, type StepCall } from '@cpn-console/hooks'
import { removeTrailingSlash, requiredEnv } from '@cpn-console/shared'
import {
  createGroup,
  findGroup,
  findProject,
  Group,
  Project as GitlabProject,
  createProject,
  getGitlabYamlFileContent,
  commitAndPushYamlFile,
} from './gitlab.js'
import { Gitlab } from '@gitbeaker/rest'
import { Gitlab as IGitlab } from '@gitbeaker/core'

import { readYamlFile, writeYamlFile } from './yaml.js'
import type { BaseParams, Stage } from './utils.js'
import { ensureKeycloakGroups } from './keycloak.js'
import { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import { deleteAllDataSources, deleteGrafanaInstance, ensureDataSource, ensureGrafanaInstance } from './kubernetes.js'

const valuesPath = 'helm/values.yaml'
const valuesBranch = 'main'
const getBaseParams = (project: Project, stage: Stage): BaseParams => ({ organizationName: project.organization.name, projectName: project.name, stage })

export type ListPerms = Record<'prod' | 'hors-prod', Record<'view' | 'edit', UserObject['id'][]>>

const getListPrems = (environments: Environment[]): ListPerms => {
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

const getApi = (): IGitlab => {
  let api = null
  const gitlabUrl = removeTrailingSlash(requiredEnv('GITLAB_URL'))
  const gitlabToken = requiredEnv('GITLAB_TOKEN')
  // @ts-ignore
  api = new Gitlab({ token: gitlabToken, host: gitlabUrl })
  // @ts-ignore
  return api
}

interface ProjectLoki {
  name: string;
  groups: string[];
  uuid: string;
}

interface YamlLokiData {
  global: {
    tenants: ProjectLoki[];
  };
}

const addRepo = (data: YamlLokiData, newProject: ProjectLoki): YamlLokiData => {
  return {
    ...data,
    global: {
      ...data.global,
      tenants: [...data.global.tenants, newProject],
    },
  }
}

const findTenantByUUID = (
  data: YamlLokiData,
  uuid: string,
): ProjectLoki | undefined => {
  return data.global.tenants.find((tenant) => tenant.uuid === uuid)
}

const removeRepo = (data: YamlLokiData, uuid: string): YamlLokiData => {
  return {
    ...data,
    global: {
      ...data.global,
      tenants: data.global.tenants.filter(tenant => tenant.uuid !== uuid),
    },
  }
}

const findOrCreateGroup = async (
  api: IGitlab,
  groupName: string,
) => {
  const group = await findGroup(api, groupName)
  if (!group) {
    console.log('loki group not found, create group')
  }
  return group ?? await createGroup(api, groupName)
}

const findOrCreateRepo = async (
  api: IGitlab,
  group: Group,
  repoName: string,
): Promise<GitlabProject> => {
  try {
    let repo = await findProject(api, group, repoName)
    if (repo) {
      console.log('repo already exist')
      return repo
    } else {
      repo = await createProject(api, group, repoName, 'tibolebg')
      return repo
    }
  } catch (error: any) {
    throw new Error('error')
  }
}

// Fonction pour trouver ou créer un fichier values.yaml
const findOrCreateValuesFile = async (
  api: IGitlab,
  project: GitlabProject,
): Promise<string> => {
  const yamlData = `
  global:
    tenants:
      - name: DSO
        groups: ["/security"]
  `

  try {
    // Essayer de récupérer le fichier
    const file = await getGitlabYamlFileContent(
      api,
      project,
      valuesPath,
      valuesBranch,
    )
    return Buffer.from(file.content, 'base64').toString('utf-8')
  } catch (error) {
    console.log('File not found, creating file:')
    await commitAndPushYamlFile(
      api,
      project,
      valuesPath,
      valuesBranch,
      'Initialize values file',
      yamlData,
    )
    return yamlData
  }
}

export const upsertProject: StepCall<Project> = async (payload) => {
  try {
    // init args
    const project = payload.args
    const keycloakApi = payload.apis.keycloak
    const hasProd = project.environments.find(env => env.stage === 'prod')
    const hasNonProd = project.environments.find(env => env.stage !== 'prod')

    const hProdParams = getBaseParams(project, 'hprod')
    const prodParams = getBaseParams(project, 'prod')

    const listPerms = getListPrems(project.environments)
    await Promise.all([
      ensureKeycloakGroups(listPerms, keycloakApi),
      ...(hasProd ? upsertGrafanaConfig(prodParams, keycloakApi) : deleteGrafanaConfig(prodParams)),
      ...(hasNonProd ? upsertGrafanaConfig(hProdParams, keycloakApi) : deleteGrafanaConfig(hProdParams)),
    ])
    // init gitlab api
    const api = getApi()
    const lokiGroupName = 'loki-group'
    const lokiRepoName = 'loki-repo'
    // get or create loki group
    const gitlabLokiGroup = await findOrCreateGroup(api, lokiGroupName)
    // get or create loki repo
    const gitlabLokiRepo = await findOrCreateRepo(api, gitlabLokiGroup, lokiRepoName)
    // get or create values file
    const file = await findOrCreateValuesFile(api, gitlabLokiRepo)
    let yamlFile = await readYamlFile<YamlLokiData>(
      Buffer.from(file, 'utf-8').toString('utf-8'),
    )
    // add project to yaml
    const projectData: ProjectLoki = {
      name: project.name,
      groups: ['/security'],
      uuid: project.id,
    }
    // Check if the tenant already exists
    if (findTenantByUUID(yamlFile, project.id)) {
      return {
        status: {
          result: 'OK',
          message: 'Tenant already exists',
        },
      }
    }
    yamlFile = addRepo(yamlFile, projectData)
    const yamlString = writeYamlFile(yamlFile)
    await commitAndPushYamlFile(
      api,
      gitlabLokiRepo,
      valuesPath,
      valuesBranch,
      `Add project ${project.name}`,
      yamlString,
    )

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
        message: 'An error happend while creating Kibana resources',
      },
      error: parseError(error),
    }
  }
}

export const deleteProject: StepCall<Project> = async (payload) => {
  try {
    // Init args
    const project = payload.args
    console.log(JSON.stringify(payload.args))
    // Init GitLab API
    const api = getApi()
    const groupName = 'loki-group'
    const repoName = 'loki-repo'
    // Get or create Loki group
    const group = await findOrCreateGroup(api, groupName)
    // Get or create Loki repo
    const repo = await findOrCreateRepo(api, group, repoName)
    // Get or create values file
    const file = await findOrCreateValuesFile(api, repo)
    let yamlFile = await readYamlFile<YamlLokiData>(
      Buffer.from(file, 'utf-8').toString('utf-8'),
    )
    // Remove project from YAML
    if (findTenantByUUID(yamlFile, project.id)) {
      console.log(`Remove item with UUID: ${project.id}`)
      yamlFile = removeRepo(yamlFile, project.id)
      const yamlString = writeYamlFile(yamlFile)
      await commitAndPushYamlFile(
        api,
        repo,
        valuesPath,
        valuesBranch,
          `Remove project ${project.name}`,
          yamlString,
      )

      return {
        status: {
          result: 'OK',
          message: 'Deleted',
        },
      }
    } else {
      return {
        status: {
          result: 'OK',
          message: 'Tenant does not exist',
        },
      }
    }
  } catch (error) {
    return {
      status: {
        result: 'KO',
        message: 'An error happened while deleting Kibana resources',
      },
      error: parseError(error),
    }
  }
}

export const upsertGrafanaConfig = (params: BaseParams, keycloakApi: KeycloakProjectApi) => [
  ensureDataSource(params, 'alert-manager'),
  ensureDataSource(params, 'prometheus'),
  ensureDataSource(params, 'loki'),
  ensureGrafanaInstance(params, keycloakApi),
]

export const deleteGrafanaConfig = (params: BaseParams) => [
  deleteGrafanaInstance(params),
  deleteAllDataSources(params),
]
