import { has } from '../has/has'

// Models
import { Omit } from '../../types/omit'

export const omit = <T, K extends keyof T>(obj: T, props: K[]): Omit<T, K> => {
  const result: { [K: string]: any } = {}

  for (const key in obj) {
    if (has(key, obj) && props.indexOf(key as any) < 0) {
      result[key] = obj[key]
    }
  }

  return result as Omit<T, K>
}
