// 아주 작은 .env 로더. 이 프로젝트는 외부 의존성을 두지 않으므로 dotenv 대신 직접 읽는다.
//
// 찾는 순서
//   1) 실제 환경변수 (docker-compose 의 environment: 로 넣은 값)
//   2) 계획 파일 폴더의 .env  (docker 에서는 ./:/data 로 마운트된 그 폴더)
//   3) 프로젝트 폴더의 .env   (개발 중 PLAN_DIR 을 딴 데로 돌려놨을 때)
//
// 요청마다 다시 읽는다. 비밀번호를 바꾸면 컨테이너를 다시 띄우지 않아도 바로 적용된다.
import fs from 'node:fs'
import path from 'node:path'

// KEY=VALUE 한 줄씩. #주석, 빈 줄, 앞뒤 따옴표, export 접두어만 처리한다.
function parseEnv(text) {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

function readEnvFile(dir) {
  try {
    return parseEnv(fs.readFileSync(path.join(dir, '.env'), 'utf8'))
  } catch {
    return {}
  }
}

// dirs = 뒤질 폴더들(앞이 우선). 없는 파일은 조용히 건너뛴다.
export function envValue(key, dirs) {
  if (process.env[key]) return process.env[key]
  for (const dir of dirs) {
    const value = readEnvFile(dir)[key]
    if (value) return value
  }
  return ''
}
