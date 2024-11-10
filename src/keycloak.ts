import type { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import type KeycloakAdminClient from '@keycloak/keycloak-admin-client'
import type GroupRepresentation from '@keycloak/keycloak-admin-client/lib/defs/groupRepresentation.js'
import type UserRepresentation from '@keycloak/keycloak-admin-client/lib/defs/userRepresentation.js'
import type { ListPerms } from './function.js'
import KcAdminClient from '@keycloak/keycloak-admin-client'
import { getConfig } from './utils.js'

export async function getkcClient() {
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

async function getRootGroupProject(keycloakApi: KeycloakProjectApi): Promise<Required<GroupRepresentation> | undefined> {
  const kcClient = await getkcClient()
  const rootGroupPath = await keycloakApi.getProjectGroupPath()
  const groups = await kcClient.groups.find({ search: rootGroupPath.slice(1), exact: true })
  return groups.find(g => g.path === rootGroupPath) as Required<GroupRepresentation> | undefined
}

export async function ensureKeycloakGroups(listPerms: ListPerms, keycloakApi: KeycloakProjectApi) {
  const kcClient = await getkcClient()
  const rootGroup = await getRootGroupProject(keycloakApi)
  const rootGroupPath = await keycloakApi.getProjectGroupPath()
  if (!rootGroup) throw new Error(`Unable to find root keycloak group ${rootGroupPath}`)

  const subgroupsMetrics = await findOrCreateMetricGroupAndSubGroups(rootGroup.id)
  const promises: Promise<any>[] = []

  // à ajouter
  listPerms['hors-prod'].edit.forEach((userId) => {
    if (subgroupsMetrics['hprod-RW'].members.find(member => member.id === userId)) return
    promises.push(kcClient.users.addToGroup({ groupId: subgroupsMetrics['hprod-RW'].id, id: userId }))
  })
  listPerms['hors-prod'].view.forEach((userId) => {
    if (subgroupsMetrics['hprod-RO'].members.find(member => member.id === userId)) return
    promises.push(kcClient.users.addToGroup({ groupId: subgroupsMetrics['hprod-RO'].id, id: userId }))
  })
  listPerms.prod.edit.forEach((userId) => {
    if (subgroupsMetrics['prod-RW'].members.find(member => member.id === userId)) return
    promises.push(kcClient.users.addToGroup({ groupId: subgroupsMetrics['prod-RW'].id, id: userId }))
  })
  listPerms.prod.view.forEach((userId) => {
    if (subgroupsMetrics['prod-RO'].members.find(member => member.id === userId)) return
    promises.push(kcClient.users.addToGroup({ groupId: subgroupsMetrics['prod-RO'].id, id: userId }))
  })

  // à retirer
  subgroupsMetrics['hprod-RW'].members.forEach((member) => {
    if (listPerms['hors-prod'].edit.includes(member.id)) return
    promises.push(kcClient.users.delFromGroup({ id: member.id, groupId: subgroupsMetrics['hprod-RW'].id }))
  })
  subgroupsMetrics['hprod-RO'].members.forEach((member) => {
    if (listPerms['hors-prod'].view.includes(member.id)) return
    promises.push(kcClient.users.delFromGroup({ id: member.id, groupId: subgroupsMetrics['hprod-RO'].id }))
  })
  subgroupsMetrics['prod-RW'].members.forEach((member) => {
    if (listPerms.prod.edit.includes(member.id)) return
    promises.push(kcClient.users.delFromGroup({ id: member.id, groupId: subgroupsMetrics['prod-RW'].id }))
  })
  subgroupsMetrics['prod-RO'].members.forEach((member) => {
    if (listPerms.prod.view.includes(member.id)) return
    promises.push(kcClient.users.delFromGroup({ id: member.id, groupId: subgroupsMetrics['prod-RO'].id }))
  })

  return Promise.all(promises)
}

type GroupDetails = Required<GroupRepresentation> & { members: Required<UserRepresentation>[] }

interface SubgroupsMetrics {
  'hprod-RW': GroupDetails
  'hprod-RO': GroupDetails
  'prod-RW': GroupDetails
  'prod-RO': GroupDetails
}

async function findMetricsGroup(kcClient: KeycloakAdminClient, parentId: string) {
  const groups = await kcClient.groups.listSubGroups({ parentId })
  return groups.find(g => g.name === 'grafana') as Required<GroupRepresentation> | undefined
}

async function findOrCreateMetricGroupAndSubGroups(parentId: string): Promise<SubgroupsMetrics> {
  const kcClient = await getkcClient()
  const testMetricsGroup = await findMetricsGroup(kcClient, parentId)
  if (!testMetricsGroup) {
    const metricsGroup = await kcClient.groups.createChildGroup({ id: parentId }, { name: 'grafana' })
    return {
      'hprod-RW': await createKeycloakGrafanaSubGroup('hprod-RW', metricsGroup.id, kcClient),
      'hprod-RO': await createKeycloakGrafanaSubGroup('hprod-RO', metricsGroup.id, kcClient),
      'prod-RW': await createKeycloakGrafanaSubGroup('prod-RW', metricsGroup.id, kcClient),
      'prod-RO': await createKeycloakGrafanaSubGroup('prod-RO', metricsGroup.id, kcClient),
    }
  }
  const metricsSubGroups = await kcClient.groups.listSubGroups({ parentId: testMetricsGroup.id }) as Required<GroupRepresentation>[]
  const grafanaHorsProdEdit = metricsSubGroups.find(g => g.name === 'hprod-RW')
  const grafanaHorsProdView = metricsSubGroups.find(g => g.name === 'hprod-RO')
  const grafanaProdEdit = metricsSubGroups.find(g => g.name === 'prod-RW')
  const grafanaProdView = metricsSubGroups.find(g => g.name === 'prod-RO')
  return {
    'hprod-RW': grafanaHorsProdEdit
      ? await findDetails(grafanaHorsProdEdit, kcClient)
      : await createKeycloakGrafanaSubGroup('hprod-RW', testMetricsGroup.id, kcClient),
    'hprod-RO': grafanaHorsProdView
      ? await findDetails(grafanaHorsProdView, kcClient)
      : await createKeycloakGrafanaSubGroup('hprod-RO', testMetricsGroup.id, kcClient),
    'prod-RW': grafanaProdEdit
      ? await findDetails(grafanaProdEdit, kcClient)
      : await createKeycloakGrafanaSubGroup('prod-RW', testMetricsGroup.id, kcClient),
    'prod-RO': grafanaProdView
      ? await findDetails(grafanaProdView, kcClient)
      : await createKeycloakGrafanaSubGroup('prod-RO', testMetricsGroup.id, kcClient),
  }
}

async function createKeycloakGrafanaSubGroup(name: string, parentId: string, kcClient: KeycloakAdminClient): Promise<GroupDetails> {
  return {
    ...(await kcClient.groups.createChildGroup({ id: parentId }, { name })) as Required<GroupRepresentation>,
    members: [],
  }
}

async function findDetails(group: Required<GroupRepresentation>, kcClient: KeycloakAdminClient): Promise<GroupDetails> {
  return {
    ...group,
    members: await kcClient.groups.listMembers({ id: group.id }) as Required<UserRepresentation>[],
  }
}

export async function deleteKeycloakGroup(keycloakApi: KeycloakProjectApi) {
  const kcClient = await getkcClient()
  const projectRootGroup = await getRootGroupProject(keycloakApi)
  if (!projectRootGroup) return
  const testMetricsGroup = await findMetricsGroup(kcClient, projectRootGroup?.id)
  if (testMetricsGroup) return kcClient.groups.del({ id: testMetricsGroup.id })
}
