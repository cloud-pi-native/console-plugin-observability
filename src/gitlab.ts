import type { Gitlab as IGitlab, RepositoryFileExpandedSchema } from '@gitbeaker/core'

export interface Group {
  id: number
  name: string
  full_path: string
  web_url: string
}

export interface Project {
  id: number
  name: string
  web_url: string
}

export async function findGroup(api: IGitlab, groupName: string): Promise<Group | undefined> {
  const groups = await api.Groups.search(groupName)
  return groups.find(g => g.full_path === groupName || g.name === groupName)
}

export async function createGroup(api: IGitlab, groupName: string): Promise<Group> {
  return await api.Groups.create(groupName, groupName)
}

export async function findProject(api: IGitlab, group: Group, projectName: string): Promise<Project | undefined> {
  const projects: Project [] = await api.Groups.allProjects(group.id)
  const project = projects.find(p => p.name === projectName)
  return project
}

export async function createProject(api: IGitlab, group: Group, projectName: string, description: string): Promise<Project> {
  return await api.Projects.create({
    name: projectName,
    path: projectName,
    namespaceId: group.id,
    description,
  })
}

export async function fileExistsInRepo(api: IGitlab, project: Project, filePath: string, branch: string): Promise<boolean> {
  try {
    await api.RepositoryFiles.show(project.id, filePath, branch)
    return true
  } catch (error: any) {
    if (error.response?.status === 404) {
      return false
    }
    throw error
  }
}

export async function getGitlabYamlFileContent(api: IGitlab, project: Project, filePath: string, branch: string): Promise<RepositoryFileExpandedSchema> {
  return api.RepositoryFiles.show(project.id, filePath, branch)
}

// Fonction pour éditer, committer et pousser un fichier YAML
export async function commitAndPushYamlFile(api: IGitlab, project: Project, filePath: string, branch: string, commitMessage: string, yamlString: string): Promise<void> {
  const encodedContent = Buffer.from(yamlString).toString('utf-8')
  try {
    // Vérifier si le fichier existe déjà
    await api.RepositoryFiles.show(project.id, filePath, branch)
    // Si le fichier existe, mise à jour
    await api.RepositoryFiles.edit(project.id, filePath, branch, encodedContent, commitMessage)
    console.log(`Fichier YAML commité et poussé: ${filePath}`)
  } catch (error: any) {
    console.log('Le fichier n\'existe pas')
    // Si le fichier n'existe pas, création
    console.log(`error : ${JSON.stringify(error)}`)
    console.log(error)
    await api.RepositoryFiles.create(project.id, filePath, branch, encodedContent, commitMessage)
    console.log(`Fichier YAML créé et poussé: ${filePath}`)
  }
}
