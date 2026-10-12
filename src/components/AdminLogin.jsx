import { useEffect, useRef, useState } from 'react'

// 역할별 편집 화면 앞에 서는 잠금 화면. 비밀번호는 서버의 .env와 대조하고,
// 맞으면 서버가 역할별 HttpOnly 쿠키를 내려 준다. 브라우저에는 비밀번호가 남지 않는다.
export default function AdminLogin({ authPath = '/admin', configured, expired, maintain = false, onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${authPath}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `로그인에 실패했습니다 (${res.status})`)
      setPassword('')
      onSuccess()
    } catch (err) {
      setError(String(err.message ?? err))
      setPassword('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <div className="login-wrap">
        <form className="panel login-panel" onSubmit={submit}>
          <h1>{maintain ? '작업 유지보수' : '편집 화면'}</h1>
          <p className="muted small">
            {maintain
              ? '작업 행 추가·수정·삭제와 담당자 배정을 하려면 유지보수 비밀번호가 필요합니다. '
              : '담당자 배정·상태 변경을 하려면 편집 비밀번호가 필요합니다. '}
            일정만 볼 때는{' '}
            <a href="/">보기 화면</a>으로 가시면 됩니다.
          </p>

          {expired && !error && (
            <p className="login-notice">로그인이 만료됐습니다. 다시 입력해 주세요.</p>
          )}

          {configured === false ? (
            <p className="login-error">
              서버에 {maintain ? '유지보수' : '편집'} 비밀번호가 설정돼 있지 않습니다. 계획 파일
              폴더의 <code>.env</code> 에{' '}
              <code>{maintain ? 'MAINTAIN_PASSWORD=...' : 'ADMIN_PASSWORD=...'}</code> 를 넣어 주세요.
            </p>
          ) : (
            <>
              <label className="login-field">
                <span>비밀번호</span>
                <input
                  ref={input}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="login-btn" disabled={busy || !password}>
                {busy ? '확인 중…' : '들어가기'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
