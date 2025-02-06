import type { ServiceInfos } from '@cpn-console/hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compressUUID, ENABLED } from '@cpn-console/shared'
import { getConfig } from './utils.js'

const imageData = Buffer.from((readFileSync(join(import.meta.dirname, '../files/logo.png'))).toString('base64'))

const infos = {
  name: 'observability',
  // @ts-ignore retro compatibility
  to: ({ project, projectId, organization }) => {
    let isInfV9 = false
    const params = {
      id: '',
      slug: '',
    }
    const grafanaUrl = getConfig().grafanaUrl
    if (typeof project === 'string' && typeof organization === 'string') {
      params.id = projectId
      params.slug = `${organization}-${project}`
      isInfV9 = true
    } else {
      params.id = project.id
      params.slug = project.slug
    }
    return [
      {
        to: `${grafanaUrl}/prod-${compressUUID(String(params.id))}`,
        title: isInfV9 ? 'Production' : undefined,
        description: 'Production',
      },
      {
        to: `${grafanaUrl}/prod-${params.slug}`,
        title: isInfV9 ? 'Production ancien' : undefined,
        description: 'Production ancien',
      },
      {
        to: `${grafanaUrl}/hprod-${compressUUID(String(params.id))}`,
        title: isInfV9 ? 'Hors production' : undefined,
        description: 'Hors production',
      },
      {
        to: `${grafanaUrl}/hprod-${params.slug}`,
        title: isInfV9 ? 'Hors production ancien' : undefined,
        description: 'Hors production ancien',
      },
    ]
  },
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
