import type { Project } from '@cpn-console/hooks'
import type { Gitlab as GitlabInterface } from '@gitbeaker/core'
import type {
  Project as GitlabProject,
  Group,
} from './gitlab.js'
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

export type Type = 'prod' | 'hprod'
interface Tenant {}

interface Env {
  groups?: string[]
  tenants: {
    [x: `${Type}-${string}`]: Tenant
  }
}
export interface ProjectLoki {
  projectName: string // slug
  envs: {
    prod: Env
    hprod: Env
  }
  // urls: string[]
}

interface YamlLokiData {
  global?: {
    projects?: {
      [x: string]: ProjectLoki
    }
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

export async function upsertGitlabConfig(project: Project, gitlabApi: GitlabInterface, projectValue: ProjectLoki) {
  // Déplacer toute la logique de création ou de récupération de groupe et de repo ici
  const lokiGroupName = 'observability'
  const lokiRepoName = 'observability'
  const gitlabLokiGroup = await findOrCreateGroup(gitlabApi, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(gitlabApi, gitlabLokiGroup, lokiRepoName)

  // Récupérer ou créer le fichier values.yaml
  const file = await findOrCreateValuesFile(gitlabApi, gitlabLokiRepo)
  const yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  const projects = yamlFile.global?.projects || {}
  projects[project.id] = projectValue
  const yamlString = writeYamlFile({
    ...yamlFile,
    global: {
      ...yamlFile.global,
      projects,
    },
  })

  await commitAndPushYamlFile(
    gitlabApi,
    gitlabLokiRepo,
    valuesPath,
    valuesBranch,
    `Update project ${project.slug}`,
    yamlString,
  )
  return `Update: ${project.slug}`
}

export async function deleteGitlabYamlConfig(project: Project, gitlabApi: GitlabInterface) {
  // Même logique de groupe et de repo que pour l'upsert
  const lokiGroupName = 'observability'
  const lokiRepoName = 'observability'
  const gitlabLokiGroup = await findOrCreateGroup(gitlabApi, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(gitlabApi, gitlabLokiGroup, lokiRepoName)

  // Récupérer le fichier values.yaml
  const file = await findOrCreateValuesFile(gitlabApi, gitlabLokiRepo)
  const yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  // Rechercher le projet à supprimer
  if (yamlFile.global?.projects && !(project.id in yamlFile.global.projects)) {
    return
  }

  // Modifier le fichier YAML et commiter
  const yamlFileStripped = removeProject(yamlFile, project.id)
  const yamlString = writeYamlFile(yamlFileStripped)

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
  const strippedData = structuredClone(data)
  delete strippedData.global?.projects?.[uuid]
  return strippedData
}

// function _doesValuesDiff(actuaValues: ProjectLoki, expectedValue: ProjectLoki): boolean {
//   if (actuaValues.projectName !== expectedValue.projectName)
//     return true

//   const actualEnvKeys = Object.entries(actuaValues.envs) as [['prod' | 'hprod', Env] ]
//   if (actualEnvKeys.length !== Object.keys(expectedValue.envs).length)
//     return true

//   for (const [envName, envValue] of actualEnvKeys) {
//     if (!(envName in expectedValue.envs))
//       return true

//     if (!envValue.groups) return true
//     if (!expectedValue.envs[envName]?.groups) return true

//     if (envValue.groups.toString() !== expectedValue.envs[envName]?.groups.toString())
//       return true

//     const envTenants = Object.keys(envValue.tenants)
//     if (envTenants.length !== Object.keys(expectedValue.envs[envName]?.tenants ?? {}).length)
//       return true

//     for (const tenantName of envTenants) {
//       if (expectedValue.envs[envName] && !(tenantName in expectedValue.envs[envName].tenants))
//         return true
//     }
//   }
//   return false
// }
