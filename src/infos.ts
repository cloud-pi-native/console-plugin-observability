import { type ServiceInfos } from '@cpn-console/hooks'
import { removeTrailingSlash, requiredEnv } from '@cpn-console/shared'

const infos: ServiceInfos = {
  name: 'loki',
  to: ({ project, organization }) => `${removeTrailingSlash(requiredEnv('GRAFANA_URL'))}/${organization}-${project}`,
  title: 'Loki - Grafana',
  imgSrc: 'https://static-www.elastic.co/v3/assets/bltefdd0b53724fa2ce/blt4466841eed0bf232/5d082a5e97f2babb5af907ee/logo-kibana-32-color.svg',
  description: 'Loki - Grafana est un outil de visualisation de logs',
}

export default infos
