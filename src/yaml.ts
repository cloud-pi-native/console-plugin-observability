import type { Project } from '@cpn-console/hooks'
import type { Gitlab as GitlabInterface } from '@gitbeaker/core'
import type {
  Project as GitlabProject,
  Group,
} from './gitlab.js'
import type { TenantKeycloakMapper } from './utils.js'
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
  // urls: string[]
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

async function findOrCreateGroup(gitlabApi: GitlabInterface, groupName: string) {
  const group = await findGroup(gitlabApi, groupName)
  return group ?? await createGroup(gitlabApi, groupName)
}

async function findOrCreateRepo(gitlabApi: GitlabInterface, group: Group, repoName: string): Promise<GitlabProject> {
  try {
    const repo = await findProject(gitlabApi, group, repoName)
    if (!repo) {
      return await createProject(gitlabApi, group, repoName, 'Repo for obervatorium values, managed by DSO console')
    }
    return repo
  } catch (error) {
    throw new Error(`Unexpected error: ${error}`)
  }
}

// Fonction pour trouver ou créer un fichier values.yaml
async function findOrCreateValuesFile(gitlabApi: GitlabInterface, project: GitlabProject): Promise<string> {
  const yamlData = `
  global:
    tenants: []
  `

  try {
    // Essayer de récupérer le fichier
    const file = await getGitlabYamlFileContent(
      gitlabApi,
      project,
      valuesPath,
      valuesBranch,
    )
    return Buffer.from(file.content, 'base64').toString('utf-8')
  } catch (_error) {
    await commitAndPushYamlFile(
      gitlabApi,
      project,
      valuesPath,
      valuesBranch,
      'Initialize values file',
      yamlData,
    )
    return yamlData
  }
}

export async function upsertGitlabConfig(project: Project, gitlabApi: GitlabInterface, tenants: TenantKeycloakMapper) {
  // Déplacer toute la logique de création ou de récupération de groupe et de repo ici
  const lokiGroupName = 'observability'
  const lokiRepoName = 'observability'
  const gitlabLokiGroup = await findOrCreateGroup(gitlabApi, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(gitlabApi, gitlabLokiGroup, lokiRepoName)

  // Récupérer ou créer le fichier values.yaml
  const file = await findOrCreateValuesFile(gitlabApi, gitlabLokiRepo)
  let yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  let needUpdates = false

  const shouldBeRemoved: string[] = []
  let notFoundTenants: string[] = Object.keys(tenants)

  for (const tenant of yamlFile.global.tenants) {
    if (tenant.uuid !== project.id) continue
    if (tenant.name in tenants) {
      if (tenant.groups.toString() !== tenants[tenant.name].toString()) {
        needUpdates = true
        tenant.groups = structuredClone(tenants[tenant.name])
      }
      notFoundTenants = notFoundTenants.filter(notFoundTenant => notFoundTenant !== tenant.name)
    } else {
      needUpdates = true
      shouldBeRemoved.push(tenant.name)
    }
  }

  const newTenants = notFoundTenants.map((notFoundTenant): ProjectLoki => ({
    groups: structuredClone(tenants[notFoundTenant]),
    name: notFoundTenant,
    uuid: project.id,
  }))

  yamlFile = {
    ...yamlFile,
    global: {
      ...yamlFile.global,
      tenants: [...yamlFile.global.tenants.filter(tenant => tenant.uuid !== project.id || !shouldBeRemoved.includes(tenant.name)), ...newTenants],
    },
  }

  if (!needUpdates && !newTenants.length) {
    return 'Already up-to-date'
  }

  const yamlString = writeYamlFile(yamlFile)

  await commitAndPushYamlFile(
    gitlabApi,
    gitlabLokiRepo,
    valuesPath,
    valuesBranch,
    `Add project ${project.name}`,
    yamlString,
  )
  return `created: ${newTenants.map(tenant => tenant.name)}, deleted: ${shouldBeRemoved}`
}

export async function deleteGitlabYamlConfig(project: Project, gitlabApi: GitlabInterface) {
  // Même logique de groupe et de repo que pour l'upsert
  const lokiGroupName = 'observability'
  const lokiRepoName = 'observability'
  const gitlabLokiGroup = await findOrCreateGroup(gitlabApi, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(gitlabApi, gitlabLokiGroup, lokiRepoName)

  // Récupérer le fichier values.yaml
  const file = await findOrCreateValuesFile(gitlabApi, gitlabLokiRepo)
  let yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  // Rechercher le projet à supprimer
  if (!yamlFile.global.tenants.find(tenant => tenant.uuid === project.id)) {
    return
  }

  // Modifier le fichier YAML et commiter
  yamlFile = removeProject(yamlFile, project.id)
  const yamlString = writeYamlFile(yamlFile)

  return commitAndPushYamlFile(
    gitlabApi,
    gitlabLokiRepo,
    valuesPath,
    valuesBranch,
    `Delete project ${project.name}`,
    yamlString,
  )
}

function removeProject(data: YamlLokiData, uuid: string): YamlLokiData {
  return {
    ...data,
    global: {
      ...data.global,
      tenants: data.global.tenants.filter(tenant => tenant.uuid !== uuid),
    },
  }
}
