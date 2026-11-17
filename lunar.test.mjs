import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solar2lunar, lunar2solar, leapMonth, monthDays, lunarYearDays } from './lunar.js'

test('春节锚点(正月初一)', () => {
  const cases = [
    [2020, 1, 25], [2021, 2, 12], [2022, 2, 1], [2023, 1, 22], [2024, 2, 10],
    [2025, 1, 29], [2026, 2, 17], [2027, 2, 6],
  ]
  for (const [y, m, d] of cases) {
    const back = lunar2solar(y, 1, 1)
    assert.deepEqual({ y: back.y, m: back.m, d: back.d }, { y, m, d }, y + ' 春节')
    const l = solar2lunar(y, m, d)
    assert.equal(l.month, 1, y + ' 月份')
    assert.equal(l.day, 1, y + ' 日')
    assert.equal(l.year, y)
  }
})

test('中秋/端午锚点', () => {
  assert.deepEqual(solar2lunar(2025, 10, 6), { year: 2025, month: 8, day: 15, isLeap: false })
  assert.deepEqual(solar2lunar(2025, 5, 31), { year: 2025, month: 5, day: 5, isLeap: false })
  assert.deepEqual(solar2lunar(2024, 9, 17), { year: 2024, month: 8, day: 15, isLeap: false })
})

test('闰月存在性与往返', () => {
  assert.equal(leapMonth(2023), 2)
  assert.equal(leapMonth(2025), 6)
  assert.equal(leapMonth(2024), 0)
  const back = lunar2solar(2025, 6, 15, true)
  const l = solar2lunar(back.y, back.m, back.d)
  assert.equal(l.month, 6)
  assert.equal(l.day, 15)
  assert.equal(l.isLeap, true)
  assert.equal(l.year, 2025)
})

test('全年天数合理', () => {
  assert.equal(lunarYearDays(2023), 384)
  assert.equal(lunarYearDays(2024), 354)
  assert.equal(monthDays(2025, 6), 30)
})
