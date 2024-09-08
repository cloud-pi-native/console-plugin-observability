// @ts-ignore
import yaml from 'js-yaml'
import { Gitlab as IGitlab } from '@gitbeaker/core'
import { type Project } from '@cpn-console/hooks'
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
import { BaseParams } from './utils.js'

const valuesPath = 'helm/values.yaml'
const valuesBranch = 'main'

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

export const readYamlFile = async <T> (fileContent: string): Promise<T> => {
  return yaml.load(fileContent) as T
}

export const writeYamlFile = (data: object): string => {
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

const findOrCreateGroup = async (
  api: IGitlab,
  groupName: string,
) => {
  const group = await findGroup(api, groupName)
  return group ?? await createGroup(api, groupName)
}

const findOrCreateRepo = async (
  api: IGitlab,
  group: Group,
  repoName: string,
): Promise<GitlabProject> => {
  try {
    const repo = await findProject(api, group, repoName)
    if (!repo) {
      return await createProject(api, group, repoName, 'tibolebg');
    }
    return repo
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

export const upsertGitlabConfig = async (params: BaseParams, keycloakRootGroupPath: string, project: Project, api: IGitlab) => {
  // Déplacer toute la logique de création ou de récupération de groupe et de repo ici
  const lokiGroupName = 'loki-group'
  const lokiRepoName = 'loki-repo'
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

export const deleteGitlabYamlConfig = async (params: BaseParams, project: Project, api: IGitlab) => {
  // Même logique de groupe et de repo que pour l'upsert
  const lokiGroupName = 'loki-group'
  const lokiRepoName = 'loki-repo'
  const gitlabLokiGroup = await findOrCreateGroup(api, lokiGroupName)
  const gitlabLokiRepo = await findOrCreateRepo(api, gitlabLokiGroup, lokiRepoName)

  // Récupérer le fichier values.yaml
  const file = await findOrCreateValuesFile(api, gitlabLokiRepo)
  let yamlFile = await readYamlFile<YamlLokiData>(Buffer.from(file, 'utf-8').toString('utf-8'))

  const tenantName = `${params.stage}-${params.organizationName}-${params.projectName}`

  // Rechercher le projet à supprimer
  const projectToDelete = yamlFile.global.tenants.find((tenant) => tenant.name === tenantName)
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


const addYamlObjectToRepo = (data: YamlLokiData, newProject: ProjectLoki): YamlLokiData => {
  return {
    ...data,
    global: {
      ...data.global,
      tenants: [...data.global.tenants, newProject],
    },
  }
}

const findTenantByName = (
  data: YamlLokiData,
  name: string,
): ProjectLoki | undefined => {
  return data.global.tenants.find((tenant) => tenant.name === name)
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
