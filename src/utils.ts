import { removeTrailingSlash, requiredEnv } from '@cpn-console/shared'

const config: {
  grafanaUrl?: string
  keycloakProtocol?: string
  keycloakDomain?: string
  keycloakRealm?: string
  keycloakToken?: string
  keycloakUser?: string
} = {
  grafanaUrl: undefined,
  keycloakProtocol: undefined,
  keycloakDomain: undefined,
  keycloakRealm: undefined,
  keycloakToken: undefined,
  keycloakUser: undefined,
}

export function getConfig(): Required<typeof config> {
  config.grafanaUrl = config.grafanaUrl ? removeTrailingSlash(config.grafanaUrl) : removeTrailingSlash(requiredEnv('GRAFANA_URL'))
  config.keycloakProtocol = config.keycloakProtocol ?? requiredEnv('KEYCLOAK_PROTOCOL')
  config.keycloakDomain = config.keycloakDomain ?? requiredEnv('KEYCLOAK_DOMAIN')
  config.keycloakRealm = config.keycloakRealm ?? requiredEnv('KEYCLOAK_REALM')
  config.keycloakToken = config.keycloakToken ?? requiredEnv('KEYCLOAK_ADMIN_PASSWORD')
  config.keycloakUser = config.keycloakUser ?? requiredEnv('KEYCLOAK_ADMIN')
  // @ts-ignore
  return config
}

export type Stage = 'prod' | 'hprod'

export interface TenantInfo {
  groups: string[]
  type: 'prod' | 'hprod'
  name: string // tenant name, short-uuid or slug
}
export interface TenantKeycloakMapper {
  [x: string]: TenantInfo // fullName, type + (short-uuid or slug)
}

const re = /[a-z0-9]{25}--[a-z0-9]{25}/
export function isNewNsName(ns: string) {
  return re.test(ns)
}
