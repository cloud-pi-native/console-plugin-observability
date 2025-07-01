import type { Project } from '@cpn-console/hooks'
import type { Gitlab as GitlabInterface, ProjectSchema } from '@gitbeaker/core'
import type {
  Project as GitlabProject,
  Group,
} from './gitlab.js'
// @ts-ignore
import yaml from 'js-yaml'
import {
  commitAndPushYamlFile,
  getGitlabYamlFileContent,
} from './gitlab.js'

const valuesPath = 'helm/values.yaml'
const valuesBranch = 'main'
const groupName = 'observability'
const repoName = 'observability'

export type EnvType = 'prod' | 'hprod'
interface Tenant {}

interface Env {
  groups?: string[]
  tenants: {
    [x: `${EnvType}-${string}`]: Tenant
  }
}
export interface ObservabilityProject {
  projectName: string // slug
  envs: {
    prod: Env
    hprod: Env
  }
}

interface ObservabilityData {
  global: {
    projects: {
      [x: string]: ObservabilityProject
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
  const groups = await gitlabApi.Groups.search(groupName)
  const group = groups.find(g => g.full_path === groupName || g.name === groupName)
  return group ?? await gitlabApi.Groups.create(groupName, groupName)
}

async function findOrCreateRepo(gitlabApi: GitlabInterface, group: Group, repoName: string): Promise<GitlabProject> {
  try {
    const projects: ProjectSchema[] = await gitlabApi.Groups.allProjects(group.id)
    const repo = projects.find(p => p.name === repoName)
    if (!repo) {
      return gitlabApi.Projects.create({
        name: repoName,
        path: repoName,
        namespaceId: group.id,
        description: 'Repo for Observatorium values, managed by DSO console',
      })
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

export async function upsertGitlabConfig(project: Project, gitlabApi: GitlabInterface, projectValue: ObservabilityProject) {
  // Déplacer toute la logique de création ou de récupération de groupe et de repo ici
  const gitlabGroup = await findOrCreateGroup(gitlabApi, groupName)
  const gitlabRepo = await findOrCreateRepo(gitlabApi, gitlabGroup, repoName)

  // Récupérer ou créer le fichier values.yaml
  const file = await findOrCreateValuesFile(gitlabApi, gitlabRepo)
  const yamlFile = await yaml.load(Buffer.from(file, 'utf-8').toString('utf-8')) as ObservabilityData

  const projects = yamlFile.global?.projects || {}

  if (JSON.stringify(projects[project.id]) === JSON.stringify(projectValue)) {
    return 'Already up-to-date'
  }

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
    gitlabRepo,
    valuesPath,
    valuesBranch,
    `Update project ${project.slug}`,
    yamlString,
  )
  return `Update: ${project.slug}`
}

export async function deleteProjectConfig(project: Project, gitlabApi: GitlabInterface) {
  // Même logique de groupe et de repo que pour l'upsert
  const gitlabGroup = await findOrCreateGroup(gitlabApi, groupName)
  const gitlabRepo = await findOrCreateRepo(gitlabApi, gitlabGroup, repoName)

  // Récupérer le fichier values.yaml
  const file = await findOrCreateValuesFile(gitlabApi, gitlabRepo)
  const yamlFile = await yaml.load(Buffer.from(file, 'utf-8').toString('utf-8')) as ObservabilityData

  // Rechercher le projet à supprimer
  if (yamlFile.global?.projects && !(project.id in yamlFile.global.projects)) {
    return
  }

  // Modifier le fichier YAML et commiter
  const yamlFileStripped = removeProject(yamlFile, project.id)
  const yamlString = writeYamlFile(yamlFileStripped)

  return commitAndPushYamlFile(
    gitlabApi,
    gitlabRepo,
    valuesPath,
    valuesBranch,
    `Delete project ${project.name}`,
    yamlString,
  )
}

function removeProject(data: ObservabilityData, uuid: string): ObservabilityData {
  const strippedData = structuredClone(data)
  delete strippedData.global?.projects?.[uuid]
  return strippedData
}
