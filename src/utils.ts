import { removeTrailingSlash, requiredEnv } from '@cpn-console/shared'
import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node'

const config: {
  observatoriumUrl?: string
  grafanaHost?: string
  grafanaUrl?: string
  grafanaNamespace?: string
  mimirUrl?: string
  lokiUrl?: string
  kubeconfigPath?: string
  kubeconfigCtx?: string
  keycloakUrl?: string
  keycloakClientSecret?: string
  keycloakClientId?: string
  keycloakProtocol?: string
  keycloakDomain?: string
  keycloakRealm?: string
  keycloakToken?: string
  keycloakUser?: string
  HTTP_PROXY?: string
  HTTPS_PROXY?: string
  NO_PROXY?: string
} = {
  observatoriumUrl: undefined,
  grafanaHost: undefined,
  grafanaUrl: undefined,
  grafanaNamespace: undefined,
  mimirUrl: undefined,
  lokiUrl: undefined,
  kubeconfigPath: undefined,
  kubeconfigCtx: undefined,
  keycloakUrl: undefined,
  keycloakClientSecret: undefined,
  keycloakClientId: undefined,
  keycloakProtocol: undefined,
  keycloakDomain: undefined,
  keycloakRealm: undefined,
  keycloakToken: undefined,
  keycloakUser: undefined,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  NO_PROXY: undefined,
}

export const getConfig = (): Required<typeof config> => {
  config.grafanaHost = config.grafanaHost ?? requiredEnv('GRAFANA_HOST')
  config.grafanaUrl = config.grafanaUrl ?? removeTrailingSlash(requiredEnv('GRAFANA_URL'))
  config.grafanaNamespace = config.grafanaNamespace ?? requiredEnv('GRAFANA_NAMESPACE')
  config.mimirUrl = config.mimirUrl ?? removeTrailingSlash(requiredEnv('MIMIR_URL'))
  config.lokiUrl = config.lokiUrl ?? removeTrailingSlash(requiredEnv('LOKI_URL'))
  config.kubeconfigPath = config.kubeconfigPath ?? process.env.KUBECONFIG_PATH
  config.kubeconfigCtx = config.kubeconfigCtx ?? process.env.KUBECONFIG_CTX
  config.keycloakUrl = removeTrailingSlash(requiredEnv('KEYCLOAK_URL'))
  config.keycloakClientId = config.keycloakClientId ?? requiredEnv('KEYCLOAK_CLIENT_ID_GRAFANA')
  config.keycloakClientSecret = config.keycloakClientSecret ?? requiredEnv('KEYCLOAK_CLIENT_SECRET_GRAFANA')
  config.keycloakProtocol = config.keycloakProtocol ?? process.env.KEYCLOAK_PROTOCOL
  config.keycloakDomain = config.keycloakDomain ?? process.env.KEYCLOAK_DOMAIN
  config.keycloakRealm = config.keycloakRealm ?? process.env.KEYCLOAK_REALM
  config.keycloakToken = config.keycloakToken ?? process.env.KEYCLOAK_ADMIN_PASSWORD
  config.keycloakUser = config.keycloakUser ?? process.env.KEYCLOAK_ADMIN
  config.HTTP_PROXY = config.HTTP_PROXY ?? process.env.HTTP_PROXY
  config.HTTPS_PROXY = config.HTTPS_PROXY ?? process.env.HTTPS_PROXY
  config.NO_PROXY = config.NO_PROXY ?? process.env.NO_PROXY
  config.observatoriumUrl = config.observatoriumUrl ?? removeTrailingSlash(requiredEnv('OBSERVATORIUM_URL'))
  // @ts-ignore
  return config
}

const getClient = () => {
  const kubeconfigCtx = process.env.KUBECONFIG_CTX
  const kubeconfigPath = process.env.KUBECONFIG_PATH
  const kc = new KubeConfig()
  if (kubeconfigPath) {
    kc.loadFromFile(kubeconfigPath)
    if (kubeconfigCtx) {
      kc.setCurrentContext(kubeconfigCtx)
    }
    return kc
  }
  kc.loadFromCluster()
  return kc
}

let k8sApi: CoreV1Api | undefined
let customK8sApi: CustomObjectsApi | undefined

export const getK8sApi = (): CoreV1Api => {
  k8sApi = k8sApi ?? getClient().makeApiClient(CoreV1Api)
  return k8sApi
}

export const getCustomK8sApi = (): CustomObjectsApi => {
  customK8sApi = customK8sApi ?? getClient().makeApiClient(CustomObjectsApi)
  return customK8sApi
}

export type Stage = 'prod' | 'hprod'

export type BaseParams = {
  organizationName: string
  projectName: string
  stage: Stage
}
