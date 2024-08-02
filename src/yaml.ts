// @ts-ignore
import yaml from 'js-yaml'

export const readYamlFile = async <T> (fileContent: string): Promise<T> => {
  return yaml.load(fileContent) as T
}

export const writeYamlFile = (data: object): string => {
  try {
    const yamlStr = yaml.dump(data, {
      styles: {
        '!!seq': 'flow',
      },
      sortKeys: false,
      lineWidth: -1, // Pour éviter le retour à la ligne automatique
    })
    console.log(`yamlStr: ${yamlStr}`)
    return yamlStr
  } catch (e) {
    console.error(e)
    return ''
  }
}
