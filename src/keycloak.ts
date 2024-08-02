import type KeycloakAdminClient from '@keycloak/keycloak-admin-client'
import type GroupRepresentation from '@keycloak/keycloak-admin-client/lib/defs/groupRepresentation.js'
import KcAdminClient from '@keycloak/keycloak-admin-client'
import { getConfig } from './utils.js'
import { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import UserRepresentation from '@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js'
import { ListPerms } from './function.js'

export const getkcClient = async () => {
  const kcClient = new KcAdminClient({
    baseUrl: `${getConfig().keycloakProtocol}://${getConfig().keycloakDomain}`,
  })

  await kcClient.auth({
    clientId: 'admin-cli',
    grantType: 'password',
    username: getConfig().keycloakUser,
    password: getConfig().keycloakToken,
  })
  kcClient.setConfig({ realmName: getConfig().keycloakRealm })
  return kcClient
}

const getRootGroupProject = async (keycloakApi: KeycloakProjectApi): Promise<Required<GroupRepresentation> | undefined> => {
  const kcClient = await getkcClient()
  const rootGroupPath = await keycloakApi.getProjectGroupPath()
  const groups = await kcClient.groups.find({ search: rootGroupPath.slice(1), exact: true })
  return groups.find(g => g.path === rootGroupPath) as Required<GroupRepresentation> | undefined
}

export const ensureKeycloakGroups = async (listPerms: ListPerms, keycloakApi: KeycloakProjectApi) => {
  const kcClient = await getkcClient()
  const rootGroup = await getRootGroupProject(keycloakApi)
  const rootGroupPath = await keycloakApi.getProjectGroupPath()
  if (!rootGroup) throw new Error(`Unable to find root keycloak group ${rootGroupPath}`)

  const subgroupsMetrics = await findOrCreateMetricGroupAndSubGroups(rootGroup.id)
  const promises: Promise<any>[] = []

  listPerms.tenant.edit.forEach(userId => {
    if (subgroupsMetrics.RW.members.find(member => member.id === userId)) return
    promises.push(kcClient.users.addToGroup({ groupId: subgroupsMetrics.RW.id, id: userId }))
  })
  listPerms.tenant.view.forEach(userId => {
    if (subgroupsMetrics.RO.members.find(member => member.id === userId)) return
    promises.push(kcClient.users.addToGroup({ groupId: subgroupsMetrics.RO.id, id: userId }))
  })
  // à retirer
  subgroupsMetrics.RW.members.forEach(member => {
    if (listPerms.tenant.edit.includes(member.id)) return
    promises.push(kcClient.users.delFromGroup({ id: member.id, groupId: subgroupsMetrics.RW.id }))
  })
  subgroupsMetrics.RO.members.forEach(member => {
    if (listPerms.tenant.view.includes(member.id)) return
    promises.push(kcClient.users.delFromGroup({ id: member.id, groupId: subgroupsMetrics.RO.id }))
  })

  return Promise.all(promises)
}

type GroupDetails = Required<GroupRepresentation> & { members: Required<UserRepresentation>[] }

type SubgroupsMetrics = {
  'RW': GroupDetails
  'RO': GroupDetails
}

const findMetricsGroup = async (kcClient: KeycloakAdminClient, parentId: string) => {
  const groups = await kcClient.groups.listSubGroups({ parentId })
  return groups.find(g => g.name === 'grafana') as Required<GroupRepresentation> | undefined
}

const findOrCreateMetricGroupAndSubGroups = async (parentId: string): Promise<SubgroupsMetrics> => {
  const kcClient = await getkcClient()
  const testMetricsGroup = await findMetricsGroup(kcClient, parentId)
  if (!testMetricsGroup) {
    const metricsGroup = await kcClient.groups.createChildGroup({ id: parentId }, { name: 'grafana' })
    return {
      RW: await createKeycloakGrafanaSubGroup('RW', metricsGroup.id, kcClient),
      RO: await createKeycloakGrafanaSubGroup('RO', metricsGroup.id, kcClient),
    }
  }
  const metricsSubGroups = await kcClient.groups.listSubGroups({ parentId: testMetricsGroup.id }) as Required<GroupRepresentation>[]
  const grafanaTenantEdit = metricsSubGroups.find(g => g.name === 'RW')
  const grafanaTenantView = metricsSubGroups.find(g => g.name === 'RO')
  return {
    RW: grafanaTenantEdit
      ? await findDetails(grafanaTenantEdit, kcClient)
      : await createKeycloakGrafanaSubGroup('RW', testMetricsGroup.id, kcClient),
    RO: grafanaTenantView
      ? await findDetails(grafanaTenantView, kcClient)
      : await createKeycloakGrafanaSubGroup('RO', testMetricsGroup.id, kcClient),
  }
}

const createKeycloakGrafanaSubGroup = async (name: string, parentId: string, kcClient: KeycloakAdminClient): Promise<GroupDetails> => ({
  ...(await kcClient.groups.createChildGroup({ id: parentId }, { name })) as Required<GroupRepresentation>,
  members: [],
})

const findDetails = async (group: Required<GroupRepresentation>, kcClient: KeycloakAdminClient): Promise<GroupDetails> => ({
  ...group,
  members: await kcClient.groups.listMembers({ id: group.id }) as Required<UserRepresentation>[],
})

export const deleteKeycloakGroup = async (keycloakApi: KeycloakProjectApi) => {
  const kcClient = await getkcClient()
  const projectRootGroup = await getRootGroupProject(keycloakApi)
  if (!projectRootGroup) return
  const testMetricsGroup = await findMetricsGroup(kcClient, projectRootGroup?.id)
  if (testMetricsGroup) return kcClient.groups.del({ id: testMetricsGroup.id })
}
