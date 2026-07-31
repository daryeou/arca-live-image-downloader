# AGENTS.md

이 문서는 Arca Image Downloader 저장소에서 작업할 때 코드, 문서, 검증 결과를 일관되게 유지하기 위한 프로젝트 기준이다.

## 프로젝트 목적

- 아카라이브와 X(Twitter) 페이지에서 사용자가 접근 가능한 이미지, GIF, 비디오를 찾아 선택 다운로드하는 Chrome Manifest V3 확장이다.
- 현재 지원 호스트는 `arca.live`, `x.com`, `twitter.com`이다.
- 확장 런타임은 `src/`에 있으며 Chrome에서 압축해제 방식으로 바로 로드한다.
- 배포 파일에는 `src/`의 내용만 포함하고 `manifest.json`을 ZIP 루트에 둔다.

## 현재 구현

- 아카라이브 게시글 본문 미디어 수집과 이모티콘 제외
- X/Twitter 트윗 이미지 묶음, GIF, 비디오 해석
- X/Twitter 페이지 세션, 직접 미디어 URL, 백그라운드 guest GraphQL 순서의 비디오 해결 경로
- Shadow DOM 선택 UI와 X/Twitter 인라인 액션 버튼
- 이미지·GIF·비디오 필터와 선택 다운로드
- 다운로드 중 항목 추가, 진행률 표시, 취소
- 재시도, 실패 이력, 중복 방지, 기존 다운로드 확인
- 사이트별 폴더 생성 옵션
- 아카라이브 동시 다운로드 `2`
- X/Twitter 동시 다운로드 `1`, 항목 간 지연 `700ms`

## 핵심 파일과 책임

- `src/manifest.json`
  - Manifest V3 권한, 허용 호스트, service worker, content script 로드 순서
- `src/config/site-config.default.json`
  - `arca_article`, `tweet_media` 어댑터의 selector, 다운로드, UI 기본 설정
- `src/shared/media-utils.js`
  - 파일명과 URL 정규화, 트윗·비디오 식별자, X API 미디어 선택 순수 함수
- `src/content/content.js`
  - 현재 호스트의 사이트 설정 선택과 DOM 미디어 수집
- `src/content/twitter-resolver.js`
  - X/Twitter 이미지·GIF·비디오 후보 및 페이지 세션 기반 해석
- `src/content/content-ui.js`
  - Shadow DOM UI, 선택 상태, 인라인 버튼, background 메시지와 상태 표시
- `src/background/twitter-api.js`
  - X/Twitter 웹 번들의 bearer token·operation ID, guest token, GraphQL 요청
- `src/background/background.js`
  - 다운로드 큐, 동시성, 지연, 중복, 재시도, 실패 이력, 영속 상태, 메시지 라우팅

## 변경 원칙

- 지원 사이트나 권한을 바꿀 때 다음 항목을 함께 확인한다.
  - `src/manifest.json`
  - `src/config/site-config.default.json`
  - 사이트별 resolver 또는 adapter
  - UI 및 background 메시지 흐름
  - `README.md`, `PRIVACY_POLICY.md`, 관련 `docs/`
  - 합성 테스트와 패키지 검증
- 공통화는 변경 이유가 같은 코드에만 적용한다.
  - 파일명과 X API 미디어 선택은 `src/shared/media-utils.js`
  - X 네트워크 요청과 토큰 캐시는 `src/background/twitter-api.js`
  - 큐 상태 변경은 `src/background/background.js`
- DOM 탐색, UI 렌더링, background 상태를 하나의 공통 모듈로 억지로 합치지 않는다.
- `src/`에는 확장 실행에 필요한 파일만 둔다. 문서, 테스트, 편집기 설정은 루트의 전용 디렉터리에 둔다.

## 개인정보와 테스트 데이터

- 실제 게시물 전체 HTML, 브라우저 네트워크 기록, 다운로드 기록을 저장소에 추가하지 않는다.
- 실사용 cookie, bearer token, guest token, API key, 세션 값, 개인 로컬 경로를 코드나 테스트에 넣지 않는다.
- 회귀 검사는 최소 구조의 합성 객체와 mock `fetch`를 사용한다.
- 공개 연락처처럼 의도적으로 공개한 정보와 인증 가능한 비밀값을 구분한다.
- 삭제한 민감 정보도 Git 이력에 남을 수 있으므로 공개 전 `git log`와 추적 파일을 함께 확인한다.

## 검증

저장소 루트에서 다음 명령을 실행한다.

```powershell
node tools/test-validate-extension.js
node tools/test-media-utils.js
node tools/test-twitter-api.js
node tools/validate-extension.js
```

배포 ZIP은 다음 명령으로 만들고 루트의 `manifest.json`과 포함 파일을 확인한다.

```powershell
pwsh -File tools/package-extension.ps1
```

브라우저 동작을 수동으로 확인하지 못했다면 정적·합성 검증과 미검증 범위를 구분해서 보고한다.

## 문서 갱신

- 실제 아키텍처, 지원 범위, 권한, 배포 방식이 바뀌면 이 문서를 같은 변경에서 갱신한다.
- 날짜별 작업 로그를 남기지 않는다.
- 단순 조사처럼 저장소 상태를 바꾸지 않은 작업에는 이 문서를 수정하지 않는다.
- 중요한 회귀 위험과 현재 제약만 유지하고 해결된 과거 상태는 제거한다.
