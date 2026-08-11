import { AppError } from './appError'
import type { VariableValue } from './workflow'

type TokenType =
  | 'identifier'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'and'
  | 'or'
  | 'not'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof'

type Token = {
  type: TokenType
  value: string
}

const OPERATORS = ['==', '!=', '>=', '<=', '>', '<']

const SIGN_PREFIX_TOKENS: TokenType[] = ['operator', 'lparen', 'comma', 'and', 'or', 'not']

function numberRegexFor(previousTokens: Token[]): RegExp {
  const previous = previousTokens[previousTokens.length - 1]
  const allowSign = !previous || SIGN_PREFIX_TOKENS.includes(previous.type)
  return allowSign ? /^-?\d+(\.\d+)?/ : /^\d+(\.\d+)?/
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }

    const operator = OPERATORS.find((item) => input.startsWith(item, index))
    if (operator) {
      tokens.push({ type: 'operator', value: operator })
      index += operator.length
      continue
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', value: char })
      index += 1
      continue
    }

    if (char === ')') {
      tokens.push({ type: 'rparen', value: char })
      index += 1
      continue
    }

    if (char === ',') {
      tokens.push({ type: 'comma', value: char })
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      index += 1
      while (index < input.length && input[index] !== quote) {
        if (input[index] === '\\' && index + 1 < input.length) {
          const next = input[index + 1]
          if (next === 'n') value += '\n'
          else if (next === 't') value += '\t'
          else if (next === 'r') value += '\r'
          else value += next
          index += 2
        } else {
          value += input[index]
          index += 1
        }
      }
      if (input[index] !== quote) {
        throw new AppError({
          code: 'EXPRESSION_INVALID',
          message: 'String is missing a closing quote',
          i18nKey: 'errors:expression.unterminatedString'
        })
      }
      tokens.push({ type: 'string', value })
      index += 1
      continue
    }

    const numberMatch = input.slice(index).match(numberRegexFor(tokens))
    if (numberMatch) {
      tokens.push({ type: 'number', value: numberMatch[0] })
      index += numberMatch[0].length
      continue
    }

    const identifierMatch = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (identifierMatch) {
      const value = identifierMatch[0]
      if (value === 'and' || value === 'or' || value === 'not') tokens.push({ type: value, value })
      else if (value === 'true' || value === 'false') tokens.push({ type: 'boolean', value })
      else if (value === 'null') tokens.push({ type: 'null', value })
      else tokens.push({ type: 'identifier', value })
      index += value.length
      continue
    }

    throw new AppError({
      code: 'EXPRESSION_INVALID',
      message: `Unrecognized expression character: ${char}`,
      i18nKey: 'errors:expression.unrecognizedChar',
      params: { char }
    })
  }

  tokens.push({ type: 'eof', value: '' })
  return tokens
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly variables: Record<string, VariableValue>
  ) {}

  parse(): boolean {
    const result = this.parseOr()
    this.expect('eof')
    return Boolean(result)
  }

  private current(): Token {
    return this.tokens[this.index]
  }

  private match(type: TokenType, value?: string): Token | null {
    const token = this.current()
    if (token.type === type && (value === undefined || token.value === value)) {
      this.index += 1
      return token
    }
    return null
  }

  private expect(type: TokenType): Token {
    const token = this.match(type)
    if (!token) {
      throw new AppError({
        code: 'EXPRESSION_INVALID',
        message: `Expression syntax error, expected ${type}`,
        i18nKey: 'errors:expression.syntaxExpected',
        params: { type }
      })
    }
    return token
  }

  private parseOr(): unknown {
    let left = this.parseAnd()
    while (this.match('or')) {
      const right = this.parseAnd()
      left = Boolean(left) || Boolean(right)
    }
    return left
  }

  private parseAnd(): unknown {
    let left = this.parseNot()
    while (this.match('and')) {
      const right = this.parseNot()
      left = Boolean(left) && Boolean(right)
    }
    return left
  }

  private parseNot(): unknown {
    if (this.match('not')) return !Boolean(this.parseNot())
    return this.parseComparison()
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary()
    const operator = this.match('operator')
    if (!operator) return left
    const right = this.parsePrimary()
    return compareValues(left, right, operator.value)
  }

  private parsePrimary(): unknown {
    const token = this.current()

    if (this.match('lparen')) {
      const value = this.parseOr()
      this.expect('rparen')
      return value
    }

    if (token.type === 'identifier' && this.tokens[this.index + 1]?.type === 'lparen') {
      return this.parseFunction()
    }

    if (this.match('identifier')) return this.variables[token.value]
    if (this.match('string')) return token.value
    if (this.match('number')) return Number(token.value)
    if (this.match('boolean')) return token.value === 'true'
    if (this.match('null')) return null

    throw new AppError({
      code: 'EXPRESSION_INVALID',
      message: `Expression syntax error, unexpected token: ${token.value}`,
      i18nKey: 'errors:expression.syntaxUnexpectedToken',
      params: { token: token.value }
    })
  }

  private parseFunction(): boolean {
    const name = this.expect('identifier').value
    this.expect('lparen')
    const args: unknown[] = []
    if (!this.match('rparen')) {
      args.push(this.parseOr())
      while (this.match('comma')) {
        args.push(this.parseOr())
      }
      this.expect('rparen')
    }

    const functions: Record<string, { arity: number; fn: (args: unknown[]) => boolean }> = {
      contains: { arity: 2, fn: ([a, b]) => String(a ?? '').includes(String(b ?? '')) },
      startsWith: { arity: 2, fn: ([a, b]) => String(a ?? '').startsWith(String(b ?? '')) },
      endsWith: { arity: 2, fn: ([a, b]) => String(a ?? '').endsWith(String(b ?? '')) }
    }
    const spec = functions[name]
    if (!spec) {
      throw new AppError({
        code: 'EXPRESSION_INVALID',
        message: `Unsupported function: ${name}`,
        i18nKey: 'errors:expression.unsupportedFunction',
        params: { name }
      })
    }
    if (args.length !== spec.arity) {
      throw new AppError({
        code: 'EXPRESSION_INVALID',
        message: `${name} expects ${spec.arity} argument(s) but received ${args.length}`,
        i18nKey: 'errors:expression.functionArity',
        params: { name, expected: spec.arity, received: args.length }
      })
    }
    return spec.fn(args)
  }
}

function compareValues(left: unknown, right: unknown, operator: string): boolean {
  if (operator === '==') return left === right
  if (operator === '!=') return left !== right

  if (typeof left === 'string' && typeof right === 'string') {
    if (operator === '>') return left > right
    if (operator === '>=') return left >= right
    if (operator === '<') return left < right
    if (operator === '<=') return left <= right
  }

  const lhs = typeof left === 'number' ? left : Number(left)
  const rhs = typeof right === 'number' ? right : Number(right)
  if (Number.isNaN(lhs) || Number.isNaN(rhs)) return false

  if (operator === '>') return lhs > rhs
  if (operator === '>=') return lhs >= rhs
  if (operator === '<') return lhs < rhs
  if (operator === '<=') return lhs <= rhs
  throw new AppError({
    code: 'EXPRESSION_INVALID',
    message: `Unsupported operator: ${operator}`,
    i18nKey: 'errors:expression.unsupportedOperator',
    params: { operator }
  })
}

export function evaluateExpression(input: string, variables: Record<string, VariableValue>): boolean {
  return new Parser(tokenize(input), variables).parse()
}
