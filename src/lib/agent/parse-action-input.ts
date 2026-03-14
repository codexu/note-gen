function closeJsonStructures(jsonStr: string): string {
  const stack: string[] = []
  let inString = false
  let escapeNext = false

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      if (!inString && stack[stack.length - 1] === '"') {
        stack.pop()
      } else if (inString) {
        stack.push('"')
      }
      continue
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char)
      } else if (char === '}' && stack[stack.length - 1] === '{') {
        stack.pop()
      } else if (char === ']' && stack[stack.length - 1] === '[') {
        stack.pop()
      }
    }
  }

  if (inString) {
    jsonStr += '"'
  }

  while (stack.length > 0) {
    const open = stack.pop()
    if (open === '"') {
      jsonStr += '"'
    } else if (open === '[') {
      jsonStr += ']'
    } else if (open === '{') {
      jsonStr += '}'
    }
  }

  return jsonStr
}

function escapeLiteralNewlinesInStrings(jsonStr: string): string {
  let result = ''
  let inString = false
  let escapeNext = false

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i]

    if (escapeNext) {
      result += char
      escapeNext = false
      continue
    }

    if (char === '\\') {
      result += char
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      result += char
      continue
    }

    if (inString && char === '\n') {
      result += '\\n'
      continue
    }

    if (inString && char === '\r') {
      result += '\\r'
      continue
    }

    result += char
  }

  return result
}

export function parseActionInputJson(jsonStr: string): Record<string, any> | null {
  try {
    return JSON.parse(jsonStr)
  } catch {
    const repaired = closeJsonStructures(escapeLiteralNewlinesInStrings(jsonStr))

    try {
      return JSON.parse(repaired)
    } catch {
      return null
    }
  }
}
