import type { ServiceInfos } from '@cpn-console/hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENABLED } from '@cpn-console/shared'
import { getConfig } from './utils.js'

const imageData = Buffer.from((readFileSync(join(import.meta.dirname, '../files/logo.png'))).toString('base64'))

const infos = {
  name: 'observability',
  // @ts-ignore retro compatibility
  to: ({ project, projectId, organization, store }) => {
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
    const urls: Array<{ to: string, title?: string, description: string }> = []
    const instances = store.observability?.instances?.split(',') ?? []
    if (instances.includes('hprod')) {
      urls.push({
        to: `${grafanaUrl}/hprod-${params.slug}`,
        title: isInfV9 ? 'Hors production' : undefined,
        description: 'Hors production',
      })
    }
    if (instances.includes('prod')) {
      urls.push({
        to: `${grafanaUrl}/prod-${params.slug}`,
        title: isInfV9 ? 'Production' : undefined,
        description: 'Production',
      })
    }
    return urls
  },
  title: 'Grafana',
  imgSrc: `data:image/png;base64,${imageData}`,
  description: 'Grafana est un outil de visualisation de métriques et de logs',
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
    project: [{
      kind: 'text',
      key: 'instances',
      permissions: {
        admin: { read: false, write: false },
        user: { read: false, write: false },
      },
      title: 'Instances actives',
      value: '',
      description: '',
    }],
  },
} as const satisfies ServiceInfos

export default infos
