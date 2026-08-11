import { describe, expect, it } from 'vitest'
import { evaluateExpression } from './expression'

describe('expression engine', () => {
  it('evaluates comparisons, logical operators, and string helpers', () => {
    const variables = {
      plan_review_input: '继续',
      sys_last_command_exit_code: 0,
      output: 'Plan.md looks good'
    }

    expect(evaluateExpression('plan_review_input == "继续"', variables)).toBe(true)
    expect(evaluateExpression('sys_last_command_exit_code == 0 and contains(output, "Plan")', variables)).toBe(true)
    expect(evaluateExpression('not startsWith(output, "Error")', variables)).toBe(true)
  })

  it('does not execute arbitrary JavaScript', () => {
    expect(() => evaluateExpression('process.exit()', {})).toThrow()
  })

  it('returns false for NaN comparisons', () => {
    expect(evaluateExpression('3 > NaN', {})).toBe(false)
    expect(evaluateExpression('NaN >= 3', {})).toBe(false)
    expect(evaluateExpression('NaN < NaN', {})).toBe(false)
    expect(evaluateExpression('NaN <= 0', {})).toBe(false)
  })

  it('handles null and undefined variable references', () => {
    expect(evaluateExpression('null == null', {})).toBe(true)
    expect(evaluateExpression('null == 0', {})).toBe(false)
    expect(evaluateExpression('not null', {})).toBe(true)
    expect(evaluateExpression('does_not_exist == null', {})).toBe(false)
  })

  it('evaluates string comparisons lexicographically', () => {
    expect(evaluateExpression('"abc" < "def"', {})).toBe(true)
    expect(evaluateExpression('"xyz" > "abc"', {})).toBe(true)
    expect(evaluateExpression('"same" == "same"', {})).toBe(true)
    expect(evaluateExpression('"abc" >= "abc"', {})).toBe(true)
  })

  it('handles complex nested expressions with parentheses', () => {
    const variables = { a: 1, b: 2, c: 3 }
    expect(evaluateExpression('(a == 1) and (b == 2) and (c == 3)', variables)).toBe(true)
    expect(evaluateExpression('(a == 2) or (b == 2)', variables)).toBe(true)
    expect(evaluateExpression('((a == 1) and (b == 2)) or (c == 99)', variables)).toBe(true)
    expect(evaluateExpression('(a == 99) and (b == 99)', variables)).toBe(false)
  })

  it('supports endsWith function', () => {
    expect(evaluateExpression('endsWith("hello world", "world")', {})).toBe(true)
    expect(evaluateExpression('endsWith("hello", "xyz")', {})).toBe(false)
  })

  it('returns false for comparison when one side is not a number', () => {
    expect(evaluateExpression('"abc" > 3', {})).toBe(false)
    expect(evaluateExpression('3 < "abc"', {})).toBe(false)
  })

  it('rejects unknown functions', () => {
    expect(() => evaluateExpression('foo("bar", "baz")', {})).toThrow()
  })

  it('rejects malformed expressions', () => {
    expect(() => evaluateExpression('(1 + 2', {})).toThrow()
    expect(() => evaluateExpression('== 3', {})).toThrow()
  })

  it('reports a clear error for unsupported subtraction', () => {
    expect(() => evaluateExpression('5-3', {})).toThrow(/Unrecognized expression character: -/)
  })

  it('still allows negative number literals after an operator', () => {
    expect(evaluateExpression('a > -3', { a: 0 })).toBe(true)
    expect(evaluateExpression('a == -3', { a: -3 })).toBe(true)
  })

  it('decodes escape sequences in string literals', () => {
    expect(evaluateExpression('contains("a\\nb", nl)', { nl: '\n' })).toBe(true)
    expect(evaluateExpression('contains("a\\\\b", bs)', { bs: '\\' })).toBe(true)
  })

  it('reports clear arity errors for functions', () => {
    expect(() => evaluateExpression('contains("a")', {})).toThrow(/contains expects 2 argument\(s\) but received/)
    expect(() => evaluateExpression('contains("a", "b", "c")', {})).toThrow(/contains expects 2 argument\(s\) but received/)
  })
})
