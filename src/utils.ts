import { requiredEnv } from '@cpn-console/shared'
import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node'

const config: {
  grafanaHost?: string
  kubeconfigPath?: string
  kubeconfigCtx?: string
  keycloakProtocol?: string
  keycloakDomain?: string
  keycloakRealm?: string
  keycloakToken?: string
  keycloakUser?: string
} = {
  grafanaHost: undefined,
  kubeconfigPath: undefined,
  kubeconfigCtx: undefined,
  keycloakProtocol: undefined,
  keycloakDomain: undefined,
  keycloakRealm: undefined,
  keycloakToken: undefined,
  keycloakUser: undefined,
}

export function getConfig(): Required<typeof config> {
  config.grafanaHost = config.grafanaHost ?? requiredEnv('GRAFANA_HOST')
  config.kubeconfigPath = config.kubeconfigPath ?? requiredEnv('KUBECONFIG_PATH')
  config.kubeconfigCtx = config.kubeconfigCtx ?? requiredEnv('KUBECONFIG_CTX')
  config.keycloakProtocol = config.keycloakProtocol ?? requiredEnv('KEYCLOAK_PROTOCOL')
  config.keycloakDomain = config.keycloakDomain ?? requiredEnv('KEYCLOAK_DOMAIN')
  config.keycloakRealm = config.keycloakRealm ?? requiredEnv('KEYCLOAK_REALM')
  config.keycloakToken = config.keycloakToken ?? requiredEnv('KEYCLOAK_ADMIN_PASSWORD')
  config.keycloakUser = config.keycloakUser ?? requiredEnv('KEYCLOAK_ADMIN')
  // @ts-ignore
  return config
}

function getClient() {
  const kubeconfigCtx = getConfig().kubeconfigCtx
  const kubeconfigPath = getConfig().kubeconfigPath
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

export function getK8sApi(): CoreV1Api {
  k8sApi = k8sApi ?? getClient().makeApiClient(CoreV1Api)
  return k8sApi
}

export function getCustomK8sApi(): CustomObjectsApi {
  customK8sApi = customK8sApi ?? getClient().makeApiClient(CustomObjectsApi)
  return customK8sApi
}

export type Stage = 'prod' | 'hprod'

export interface BaseParams {
  organizationName: string
  projectName: string
  stage: Stage
}
