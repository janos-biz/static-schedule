import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createPlanApi } from './server/planApi.mjs'
import { createAuth } from './server/auth.mjs'
import { envValue } from './server/env.mjs'

// 별도 백엔드 없이 vite 개발 서버가 plan-YYMMDD.md를 직접 읽고 쓴다.
// 운영(docker)에서는 server/index.mjs 가 같은 API를 담당한다. 역할별 비밀번호도 같은 코드를 쓴다.
function planFilePlugin() {
  const planDir = process.env.PLAN_DIR || process.cwd()
  const auth = createAuth(
    () => envValue('ADMIN_PASSWORD', [planDir, process.cwd()]),
    () => envValue('MAINTAIN_PASSWORD', [planDir, process.cwd()]),
  )
  const planApi = createPlanApi(planDir, { canWrite: auth.isAuthed, canVersion: auth.isMaintainer })

  return {
    name: 'plan-file',
    configureServer(server) {
      server.middlewares.use(auth.middleware)
      server.middlewares.use(planApi)
    },
  }
}

export default defineConfig({
  plugins: [react(), planFilePlugin()],
  server: {
    host: true, // 사내 와이파이에서 접속 가능하도록 0.0.0.0 바인딩
    port: 5180,
    strictPort: true,
  },
})
