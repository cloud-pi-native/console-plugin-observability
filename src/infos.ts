import type { ServiceInfos } from '@cpn-console/hooks'
import { getConfig } from './utils.js'

const infos: ServiceInfos = {
  name: 'observability',
  to: ({ project, organization }) => [
    {
      to: `${getConfig().grafanaUrl}/hprod-${organization}-${project}`,
      title: 'Hors production',
    },
    {
      to: `${getConfig().grafanaUrl}/prod-${organization}-${project}`,
      title: 'Production',
    },
  ],
  title: 'Grafana',
  imgSrc: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Grafana_logo.svg',
  description: 'Grafana est un outil de métrique et de logs',
}

export default infos
