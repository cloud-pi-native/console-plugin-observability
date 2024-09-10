import { KeycloakProjectApi } from '@cpn-console/keycloak-plugin/types/class.js'
import { BaseParams, getConfig, getCustomK8sApi, Stage } from './utils.js'
import { PatchUtils } from '@kubernetes/client-node'

const patchOptions = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } }

const computeGrafanaName = (params: BaseParams) => params.stage === 'prod' ? `prod-${params.organizationName}-${params.projectName}` : `hprod-${params.organizationName}-${params.projectName}`
const getProjectSelector = (p: BaseParams) => [`dso/grafana-stage=${p.stage}`, `dso/organization=${p.organizationName}`, `dso/project=${p.projectName}`, 'app.kubernetes.io/managed-by=dso-console']

// #region GrafanaInstance
const getGrafanaInstanceSpec = (parentGrafanaName: string, roleAttributePath: string) => {
  const containersSpecArray = [{
    image: 'grafana/grafana:9.5.5',
    name: 'grafana',
    ...(getConfig().HTTP_PROXY && getConfig().HTTPS_PROXY) && {
      env: [
        {
          name: 'HTTP_PROXY',
          value: `${getConfig().HTTP_PROXY}`,
        },
        {
          name: 'HTTPS_PROXY',
          value: `${getConfig().HTTPS_PROXY}`,
        },
        {
          name: 'NO_PROXY',
          value: `${getConfig().NO_PROXY}`,
        },
      ],
    },
  }]
  return {
    spec: {
      config: {
        auth: {
          oauth_allow_insecure_email_lookup: 'true',
        },
        'auth.generic_oauth': {
          api_url: `${getConfig().keycloakUrl}/realms/${getConfig().keycloakRealm}/protocol/openid-connect/userinfo`,
          auth_url: `${getConfig().keycloakUrl}/realms/${getConfig().keycloakRealm}/protocol/openid-connect/auth`,
          client_id: getConfig().keycloakClientId,
          client_secret: getConfig().keycloakClientSecret,
          email_attribute_path: 'email',
          groups_attribute_path: 'groups',
          enabled: 'true',
          role_attribute_path: roleAttributePath,
          role_attribute_strict: 'true',
          scopes: 'profile, email, openid, generic',
          tls_skip_verify_insecure: 'true',
          token_url: `${getConfig().keycloakUrl}/realms/${getConfig().keycloakRealm}/protocol/openid-connect/token`,
        },
        server: {
          root_url: `${getConfig().grafanaUrl}/${parentGrafanaName}/`,
          serve_from_sub_path: 'true',
        },
      },
      deployment: {
        spec: {
          template: {
            spec: {
              containers: containersSpecArray,
            },
          },
        },
      },
      route: {
        metadata: {},
        spec: {
          host: `${getConfig().grafanaHost}`,
          path: `/${parentGrafanaName}`,
          port: {
            targetPort: 3000,
          },
          tls: {
            termination: 'edge',
          },
          to: {
            kind: 'Service',
            name: `${parentGrafanaName}-service`,
            weight: 100,
          },
          wildcardPolicy: 'None',
        },
      },
    },
  }
}

const getGrafanaInstanceObject = (params: BaseParams, roleAttributePath: string) => {
  const grafanaName = computeGrafanaName(params)
  return {
    apiVersion: 'grafana.integreatly.org/v1beta1',
    kind: 'Grafana',
    metadata: {
      labels: {
        app: grafanaName,
        dashboards: 'default',
        project: 'enabled',
        'app.kubernetes.io/managed-by': 'dso-console',
        'dso/organization': params.organizationName,
        'dso/project': params.projectName,
        'dso/grafana-stage': params.stage,
      },
      name: grafanaName,
      namespace: getConfig().grafanaNamespace,
    },
    ...getGrafanaInstanceSpec(grafanaName, roleAttributePath),
  }
}
// #endregion

const generateObservatoriumUrl = (type: string, parentGrafanaName: string) => {
  return `${getConfig().observatoriumUrl}/${type}/v1/${parentGrafanaName}`
}
// #region Prometheus
const getGrafanaPrometheusSpec = (parentGrafanaName: string) => ({
  spec: {
    datasource: {
      access: 'proxy',
      isDefault: true,
      jsonData: {
        oauthPassThru: true,
        tlsSkipVerify: true,
      },
      name: 'Prometheus',
      type: 'prometheus',
      url: `${generateObservatoriumUrl('metrics', parentGrafanaName)}/prometheus`,
    },
    instanceSelector: {
      matchLabels: {
        app: parentGrafanaName,
      },
    },
    resyncPeriod: '5m',
  },
})

const getGrafanaPrometheusDataSourceObject = (
  params: BaseParams,
  datasourceName: string,
) => {
  const parentGrafanaName = computeGrafanaName(params)
  return {
    apiVersion: 'grafana.integreatly.org/v1beta1',
    kind: 'GrafanaDatasource',
    metadata: {
      name: datasourceName,
      namespace: getConfig().grafanaNamespace,
      labels: {
        'app.kubernetes.io/managed-by': 'dso-console',
        'dso/organization': params.organizationName,
        'dso/project': params.projectName,
        'dso/grafana-stage': params.stage,
        'dso/grafana-source': 'prometheus',
      },
    },
    ...getGrafanaPrometheusSpec(parentGrafanaName),
  }
}
// #endregion

// #region AlertManager
const getGrafanaAlertManagerSpec = (parentGrafanaName: string) => ({
  spec: {
    datasource: {
      access: 'proxy',
      isDefault: true,
      jsonData: {
        oauthPassThru: true,
        tlsSkipVerify: true,
      },
      name: 'Alertmanager',
      type: 'alertmanager',
      url: generateObservatoriumUrl('metrics', parentGrafanaName),
    },
    instanceSelector: {
      matchLabels: {
        app: parentGrafanaName,
      },
    },
    resyncPeriod: '5m',
  },
})

const getGrafanaAlertManagerDataSourceObject = (
  params: BaseParams,
  datasourceName: string,
) => {
  const parentGrafanaName = computeGrafanaName(params)
  return {
    apiVersion: 'grafana.integreatly.org/v1beta1',
    kind: 'GrafanaDatasource',
    metadata: {
      name: datasourceName,
      namespace: getConfig().grafanaNamespace,
      labels: {
        'app.kubernetes.io/managed-by': 'dso-console',
        'dso/organization': params.organizationName,
        'dso/project': params.projectName,
        'dso/grafana-stage': params.stage,
        'dso/grafana-source': 'alert-manager',
      },
    },
    ...getGrafanaAlertManagerSpec(parentGrafanaName),
  }
}

const getGrafanaLokiSpec = (parentGrafanaName: string) => ({
  spec: {
    datasource: {
      access: 'proxy',
      isDefault: true,
      jsonData: {
        oauthPassThru: true,
        tlsSkipVerify: true,
      },
      name: 'loki',
      type: 'loki',
      url: generateObservatoriumUrl('logs', parentGrafanaName),
    },
    instanceSelector: {
      matchLabels: {
        app: parentGrafanaName,
      },
    },
    resyncPeriod: '5m',
  },
})

const getGrafanaLokiDataSourceObject = (
  params: BaseParams,
  datasourceName: string,
) => {
  const parentGrafanaName = computeGrafanaName(params)
  return {
    apiVersion: 'grafana.integreatly.org/v1beta1',
    kind: 'GrafanaDatasource',
    metadata: {
      name: datasourceName,
      namespace: getConfig().grafanaNamespace,
      labels: {
        'app.kubernetes.io/managed-by': 'dso-console',
        'dso/organization': params.organizationName,
        'dso/project': params.projectName,
        'dso/grafana-stage': params.stage,
        'dso/grafana-source': 'loki',
      },
    },
    ...getGrafanaLokiSpec(parentGrafanaName),
  }
}
// #endregion

// #region DataSources manipulation
const datasourcesFn = {
  prometheus: {
    specFn: getGrafanaPrometheusSpec,
    objectFn: getGrafanaPrometheusDataSourceObject,
  },
  'alert-manager': {
    specFn: getGrafanaAlertManagerSpec,
    objectFn: getGrafanaAlertManagerDataSourceObject,
  },
  loki: {
    specFn: getGrafanaLokiSpec,
    objectFn: getGrafanaLokiDataSourceObject,
  },
}

export const ensureDataSource = async (params: BaseParams, key: keyof typeof datasourcesFn) => {
  const customObjectsApi = getCustomK8sApi()
  const selectors = [...getProjectSelector(params), `dso/grafana-source=${key}`].join(',')
  const dataSources = await customObjectsApi.listNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanadatasources', undefined, undefined, undefined, undefined, selectors) as { body: {items: { metadata: { name: string } }[] } }
  const grafanaName = computeGrafanaName(params)
  // @ts-ignore
  if (dataSources.body.items.length > 1) {
    await Promise.all(
      dataSources.body.items.map(item => customObjectsApi.deleteNamespacedCustomObject(
        'grafana.integreatly.org',
        'v1beta1',
        getConfig().grafanaNamespace,
        'grafanadatasources',
        item.metadata.name,
      )),
    )
    // @ts-ignore
  } else if (dataSources.body.items.length === 1) {
    const dataSource = dataSources.body.items[0]
    const spec = datasourcesFn[key].specFn(grafanaName)
    return customObjectsApi.patchNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanadatasources', dataSource.metadata.name, spec, undefined, undefined, undefined, patchOptions)
  }
  const resourceName = `${grafanaName}-${key}`
  const object = datasourcesFn[key].objectFn(params, resourceName)
  return customObjectsApi.createNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanadatasources', object)
}

export const deleteAllDataSources = async (params: BaseParams) => {
  const customObjectsApi = getCustomK8sApi()
  const selectors = [...getProjectSelector(params), 'dso/grafana-source'].join(',')
  const dataSources = await customObjectsApi.listNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanadatasources', undefined, undefined, undefined, undefined, selectors) as { body: {items: { metadata: { name: string } }[] } }
  return Promise.all(
    dataSources.body.items.map(item => customObjectsApi.deleteNamespacedCustomObject(
      'grafana.integreatly.org',
      'v1beta1',
      getConfig().grafanaNamespace,
      'grafanadatasources',
      item.metadata.name,
    )),
  )
}
// #endregion

// #region Instance manipulation
export const getRoleAttributePath = (keycloakRootGroup: string, stage: Stage) => `contains(groups[*], '${keycloakRootGroup}/grafana/${stage}-RW') && 'Editor' || contains(groups[*], '${keycloakRootGroup}/grafana/${stage}-RO') && 'Viewer'`

export const ensureGrafanaInstance = async (params: BaseParams, keycloakApi: KeycloakProjectApi) => {
  const customObjectsApi = getCustomK8sApi()
  const keycloakRootGroupPath = await keycloakApi.getProjectGroupPath()
  const roleAttributePath = getRoleAttributePath(keycloakRootGroupPath, params.stage)
  const selectors = getProjectSelector(params).join(',')
  const { body: { items } } = await customObjectsApi.listNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanas', undefined, undefined, undefined, undefined, selectors) as { body: {items: { metadata: { name: string } }[] } }
  const grafanaName = computeGrafanaName(params)

  const grafanaInstanceObject = getGrafanaInstanceObject(params, roleAttributePath)
  if (items.length > 1 || (items.length === 1 && items[0]?.metadata.name !== grafanaName)) {
    await Promise.all(
      items.map(item => customObjectsApi.deleteNamespacedCustomObject(
        'grafana.integreatly.org',
        'v1beta1',
        getConfig().grafanaNamespace,
        'grafanas',
        item.metadata.name,
      )),
    )
  } else if (items.length === 1) {
    return customObjectsApi.patchNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanas', grafanaName, { spec: grafanaInstanceObject.spec, metadata: grafanaInstanceObject.metadata }, undefined, undefined, undefined, patchOptions)
  }
  return customObjectsApi.createNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanas', grafanaInstanceObject)
}

export const deleteGrafanaInstance = async (params: BaseParams) => {
  const customObjectsApi = getCustomK8sApi()
  const selectors = getProjectSelector(params).join(',')
  const dataSources = await customObjectsApi.listNamespacedCustomObject('grafana.integreatly.org', 'v1beta1', getConfig().grafanaNamespace, 'grafanas', undefined, undefined, undefined, undefined, selectors) as { body: {items: { metadata: { name: string } }[] } }
  return Promise.all(
    dataSources.body.items.map(item => customObjectsApi.deleteNamespacedCustomObject(
      'grafana.integreatly.org',
      'v1beta1',
      getConfig().grafanaNamespace,
      'grafanas',
      item.metadata.name,
    )),
  )
}
// #endregion
