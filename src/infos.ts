import type { ServiceInfos } from '@cpn-console/hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compressUUID, ENABLED } from '@cpn-console/shared'
import { getConfig } from './utils.js'

const imageData = Buffer.from((readFileSync(join(import.meta.dirname, '../files/logo.png'))).toString('base64'))

const infos = {
  name: 'observability',
  to: ({ project }) => [
    {
      to: `${getConfig().grafanaUrl}/prod-${compressUUID(project.id)}`,
      description: 'Production',
    },
    {
      to: `${getConfig().grafanaUrl}/prod-${project.slug}`,
      description: 'Production ancien',
    },
    {
      to: `${getConfig().grafanaUrl}/hprod-${compressUUID(project.id)}`,
      description: 'Hors production',
    },
    {
      to: `${getConfig().grafanaUrl}/hprod-${project.slug}`,
      description: 'Hors production ancien',
    },
  ],
  title: 'Grafana',
  imgSrc: `data:image/png;base64,${imageData}`,
  description: 'Grafana est un outil de métrique et de logs',
  config: {
    global: [{
      kind: 'switch',
      key: 'enabled',
      initialValue: ENABLED,
      permissions: {
        admin: { read: true, write: true },
        user: { read: true, write: false },
      },
      title: 'Activer le plugin',
      value: ENABLED,
      description: 'Activer le plugin',
    }],
    project: [],
  },
} as const satisfies ServiceInfos

export default infos
