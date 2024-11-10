import type { Project } from '@cpn-console/hooks'
import type { Gitlab as IGitlab } from '@gitbeaker/core'
import type {
  Project as GitlabProject,
  Group,
} from './gitlab.js'
import type { BaseParams } from './utils.js'
// @ts-ignore
import yaml from 'js-yaml'
import {
  commitAndPushYamlFile,
  createGroup,
  createProject,
  findGroup,
  findProject,
  getGitlabYamlFileContent,
} from './gitlab.js'

const valuesPath = 'helm/values.yaml'
const valuesBranch = 'main'

interface ProjectLoki {
  name: string
  groups: string[]
  uuid: string
}

interface YamlLokiData {
  global: {
    tenants: ProjectLoki[]
  }
}

export async function readYamlFile<T>(fileContent: string): Promise<T> {
  return yaml.load(fileContent) as T
}

export function writeYamlFile(data: object): string {
  try {
    return yaml.dump(data, {
      styles: {
        '!!seq': 'flow',
      },
      sortKeys: false,
      lineWidth: -1, // Pour éviter le retour à la ligne automatique
    })
  } catch (e) {
    console.error(e)
    return ''
  }
}

async function findOrCreateGroup(api: IGitlab, groupName: string) {
  const group = await findGroup(api, groupName)
  return group ?? await createGroup(api, groupName)
}

async function findOrCreateRepo(api: IGitlab, group: Group, repoName: string): Promise<GitlabProject> {
  try {
    const repo = await findProject(api, group, repoName)
    if (!repo) {
      return await createProject(api, group, repoName, 'Repo for obervatorium values, managed by DSO console')
    }
    return repo
  } catch (error) {
    throw new Error(`Unexpected error: ${error}`)
  }
}

// Fonction pour trouver ou créer un fichier values.yaml
async function findOrCreateValuesFile(api: IGitlab, project: GitlabProject): Promise<string> {
  const yamlData = `
  global:
    tenants: []
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
  } catch (_error) {
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

export async function upsertGitlabConfig(params: BaseParams, keycloakRootGroupPath: string, project: Project, api: IGitlab) {
  // Déplacer toute la logique de création ou de récupération de groupe et de repo ici
  const lokiGroupName = 'observability'
  const lokiRepoName = 'observability'
  const gitlabLokiGroup = await findOrCreateGroup(api, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(api, gitlabLokiGroup, lokiRepoName)

  // Récupérer ou créer le fichier values.yaml
  const file = await findOrCreateValuesFile(api, gitlabLokiRepo)
  let yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  const tenantName = `${params.stage}-${params.organizationName}-${params.projectName}`
  const tenantRbac = [`${keycloakRootGroupPath}/grafana/${params.stage}-RW`, `${keycloakRootGroupPath}/grafana/${params.stage}-RO`]

  const projectData: ProjectLoki = {
    name: tenantName,
    groups: tenantRbac,
    uuid: project.id,
  }

  if (findTenantByName(yamlFile, tenantName)) {
    return
  }

  // Modifier le fichier YAML et commiter
  yamlFile = addYamlObjectToRepo(yamlFile, projectData)
  const yamlString = writeYamlFile(yamlFile)

  return commitAndPushYamlFile(
    api,
    gitlabLokiRepo,
    valuesPath,
    valuesBranch,
    `Add project ${project.name}`,
    yamlString,
  )
}

export async function deleteGitlabYamlConfig(params: BaseParams, project: Project, api: IGitlab) {
  // Même logique de groupe et de repo que pour l'upsert
  const lokiGroupName = 'observability'
  const lokiRepoName = 'observability'
  const gitlabLokiGroup = await findOrCreateGroup(api, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(api, gitlabLokiGroup, lokiRepoName)

  // Récupérer le fichier values.yaml
  const file = await findOrCreateValuesFile(api, gitlabLokiRepo)
  let yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  const tenantName = `${params.stage}-${params.organizationName}-${params.projectName}`

  // Rechercher le projet à supprimer
  const projectToDelete = yamlFile.global.tenants.find(tenant => tenant.name === tenantName)
  if (!projectToDelete) {
    return
  }

  // Modifier le fichier YAML et commiter
  yamlFile = removeRepo(yamlFile, projectToDelete.uuid)
  const yamlString = writeYamlFile(yamlFile)

  return commitAndPushYamlFile(
    api,
    gitlabLokiRepo,
    valuesPath,
    valuesBranch,
    `Delete project ${project.name}`,
    yamlString,
  )
}

function addYamlObjectToRepo(data: YamlLokiData, newProject: ProjectLoki): YamlLokiData {
  return {
    ...data,
    global: {
      ...data.global,
      tenants: [...data.global.tenants, newProject],
    },
  }
}

function findTenantByName(data: YamlLokiData, name: string): ProjectLoki | undefined {
  return data.global.tenants.find(tenant => tenant.name === name)
}

function removeRepo(data: YamlLokiData, uuid: string): YamlLokiData {
  return {
    ...data,
    global: {
      ...data.global,
      tenants: data.global.tenants.filter(tenant => tenant.uuid !== uuid),
    },
  }
}
