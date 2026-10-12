// 화면 모드. /admin 은 일정 편집, /maintain 은 작업 행 구조까지 관리하며,
// 그 밖의 경로(기본 /)는 읽기 전용이다.
//
// 라우터를 두지 않고 주소만 보고 판단한다. 페이지가 열린 뒤에는 경로가 바뀌지 않으므로
// (탭은 #해시, 계획 날짜는 ?date= 를 쓴다) 모듈이 불러와질 때 한 번만 계산해도 된다.
export const EDIT_PATH = '/admin'
export const MAINTAIN_PATH = '/maintain'

const currentPath = () => window.location.pathname.replace(/\/+$/, '') || '/'
const path = currentPath()

export const canEdit = path === EDIT_PATH || path === MAINTAIN_PATH
export const canMaintain = path === MAINTAIN_PATH
export const authPath = canMaintain ? MAINTAIN_PATH : EDIT_PATH
