/**
 * Seed default criteria into database
 */

import { db } from './index'
import { evalCriteria } from './schema'
import { DEFAULT_CRITERIA } from '../criteria/defaults'

export async function seedDefaultCriteria() {
  const criteriaData = DEFAULT_CRITERIA.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    rubric: c.rubric,
    scoreType: c.scoreType,
    scaleConfig: JSON.stringify(c.scaleConfig || {}),
    weight: c.weight,
    isDefault: true
  }))

  await db.insert(evalCriteria).values(criteriaData)

  console.log(`Seeded ${criteriaData.length} default criteria`)
}
