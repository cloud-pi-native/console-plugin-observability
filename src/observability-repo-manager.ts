import type { GitlabProjectApi } from '@cpn-console/gitlab-plugin/types/class.js'
import type { Project } from '@cpn-console/hooks'
import type { Gitlab as IGitlab, ProjectSchema } from '@gitbeaker/core'
import { removeTrailingSlash, requiredEnv } from '@cpn-console/shared'
import { Gitlab } from '@gitbeaker/rest'
import yaml from 'js-yaml'

const valuesPath = 'helm/values.yaml'
const valuesBranch = 'main'
const groupName = 'observability'
const repoName = 'observability'
export const observabilityRepository = 'infra-observability'
const observabilityChartVersion = requiredEnv('DSO_OBSERVABILITY_CHART_VERSION')
const observabilityChartContent = `
apiVersion: v2
name: dso-observability
type: application
version: 0.1.0
appVersion: "0.0.1"
dependencies:
  - name: charts/dso-observability
    version: ${observabilityChartVersion}
    repository: https://cloud-pi-native.github.io/helm-charts/
`
const observabilityTemplateContent = `
{{- include "grafana-dashboards.dashboards" . -}}
{{- include "grafana-dashboards.rules" . -}}
`

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
  projectRepository: {
    url: string
    path: string
  }
  envs: {
    prod: Env
    hprod: Env
  }
}

interface ObservabilityData {
  global: {
    tenants?: {
      [x: string]: Tenant
    }
    projects?: {
      [x: string]: ObservabilityProject
    }
  }
}

const yamlInitData: ObservabilityData = {
  global: {
    tenants: {},
  },
}

export class ObservabilityRepoManager {
  private gitlabApi: IGitlab
  private gitlabProjectApi: GitlabProjectApi

  constructor(gitlabProjectApi: GitlabProjectApi) {
    const gitlabUrl = removeTrailingSlash(requiredEnv('GITLAB_URL'))
    const gitlabToken = requiredEnv('GITLAB_TOKEN')
    this.gitlabApi = new Gitlab({ token: gitlabToken, host: gitlabUrl })
    this.gitlabProjectApi = gitlabProjectApi
  }

  private async findOrCreateRepo(): Promise<ProjectSchema> {
    try {
      // Find or create parent Gitlab group
      const groups = await this.gitlabApi.Groups.search(groupName)
      let group = groups.find(g => g.full_path === groupName || g.name === groupName)
      if (!group) {
        group = await this.gitlabApi.Groups.create(groupName, groupName)
      }
      // Find or create parent Gitlab repository
      const projects: ProjectSchema[] = await this.gitlabApi.Groups.allProjects(group.id)
      const repo = projects.find(p => p.name === repoName)
      if (!repo) {
        return this.gitlabApi.Projects.create({
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

  // Fonction pour récupérer le fichier values.yaml
  private async getValuesFile(project: ProjectSchema): Promise<ObservabilityData | null> {
    try {
      // Essayer de récupérer le fichier
      const file = await this.gitlabApi.RepositoryFiles.show(project.id, valuesPath, valuesBranch)
      return yaml.load(Buffer.from(file.content, 'base64').toString('utf-8')) as ObservabilityData
    } catch (error) {
      console.log(error)
      return null
    }
  }

  private writeYamlFile(data: object): string {
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

  // Fonction pour éditer, committer et pousser un fichier YAML
  public async commitAndPushYamlFile(project: ProjectSchema, filePath: string, branch: string, commitMessage: string, yamlString: string): Promise<void> {
    const encodedContent = Buffer.from(yamlString).toString('utf-8')
    try {
      // Vérifier si le fichier existe déjà
      await this.gitlabApi.RepositoryFiles.show(project.id, filePath, branch)
      // Si le fichier existe, mise à jour
      await this.gitlabApi.RepositoryFiles.edit(project.id, filePath, branch, encodedContent, commitMessage)
      console.log(`Fichier YAML commité et poussé: ${filePath}`)
    } catch (error: any) {
      console.log('Le fichier n\'existe pas')
      // Si le fichier n'existe pas, création
      console.log(`error : ${JSON.stringify(error)}`)
      console.log(error)
      await this.gitlabApi.RepositoryFiles.create(project.id, filePath, branch, encodedContent, commitMessage)
      console.log(`Fichier YAML créé et poussé: ${filePath}`)
    }
  }

  public async updateProjectConfig(project: Project, projectValue: ObservabilityProject): Promise<string> {
    // Repository created during 'pre' step if needed
    const projectId = await this.gitlabProjectApi.getProjectId(observabilityRepository)
    const observabilityProjectRepository = await this.gitlabProjectApi.getProjectById(projectId)

    // Add or update chart files
    const chartUpdated = await this.gitlabProjectApi.commitCreateOrUpdate(
      observabilityProjectRepository.id,
      observabilityChartContent,
      'Chart.yaml',
    )
    const templateUpdated = await this.gitlabProjectApi.commitCreateOrUpdate(
      observabilityProjectRepository.id,
      observabilityTemplateContent,
      'templates/includes.yaml',
    )

    // Dépôt d'infra scruté par ArgoCD (charts dso-grafana et dso-observatorium)
    const gitlabRepo = await this.findOrCreateRepo()

    // Récupérer le fichier values.yaml
    const yamlFile = await this.getValuesFile(gitlabRepo)
      || yamlInitData

    const projects = yamlFile.global?.projects || {}

    if (!chartUpdated && !templateUpdated
      && JSON.stringify(projects[project.id]) === JSON.stringify(projectValue)) {
      return 'Already up-to-date'
    }

    projects[project.id] = projectValue

    const yamlString = this.writeYamlFile({
      ...yamlFile,
      global: {
        ...yamlFile.global,
        projects,
      },
    })

    await this.commitAndPushYamlFile(
      gitlabRepo,
      valuesPath,
      valuesBranch,
      `Update project ${project.slug}`,
      yamlString,
    )
    return `Update: ${project.slug}`
  }

  public async deleteProjectConfig(project: Project) {
    // Même logique de groupe et de repo que pour l'upsert
    const gitlabRepo = await this.findOrCreateRepo()

    // Récupérer le fichier values.yaml
    const yamlFile = await this.getValuesFile(gitlabRepo)

    // Rechercher le projet à supprimer
    if (!yamlFile || (yamlFile.global?.projects && !(project.id in yamlFile.global.projects))) {
      return
    }

    // Modifier le fichier YAML et commiter
    const yamlFileStripped = structuredClone(yamlFile)
    delete yamlFileStripped.global?.projects?.[project.id]

    const yamlString = this.writeYamlFile(yamlFileStripped)

    return this.commitAndPushYamlFile(
      gitlabRepo,
      valuesPath,
      valuesBranch,
      `Delete project ${project.name}`,
      yamlString,
    )
  }
}
