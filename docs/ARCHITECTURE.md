# 아키텍처

## 목표

이 확장은 빌드 도구 없이 `src/`를 Chrome에 직접 로드할 수 있는 구조를 유지한다.

- 순수 미디어·파일명 로직은 브라우저 API와 분리한다.
- 사이트 DOM 해석은 content adapter와 resolver가 담당한다.
- X/Twitter 네트워크 통신은 실행 컨텍스트별 모듈이 담당한다.
- 페이지 UI는 선택과 표시를, background는 다운로드 상태 머신을 담당한다.
- 개인정보가 없는 합성 데이터로 안정적인 경계를 자동 검증한다.

## 런타임 구조

```text
src/shared/media-utils.js
  ├─ content/content.js                 사이트 선택과 DOM 수집
  ├─ content/twitter-resolver.js        X 페이지 세션·직접 URL 해석
  │    └─ content/content-ui.js         선택 UI와 다운로드 요청 조정
  └─ background/twitter-api.js          X guest token과 GraphQL 요청
       └─ background/background.js      다운로드 큐와 영속 상태

src/config/site-config.default.json      사이트 adapter, 다운로드, UI 설정
src/manifest.json                        런타임 진입점과 권한
```

### `src/shared/media-utils.js`

DOM, `chrome.*`, 저장 상태에 의존하지 않는 공통 순수 함수를 제공한다.

- 경로와 파일명 정규화
- URL 기반 파일명 추출
- 안전한 정규식 생성
- 트윗과 X/Twitter 비디오 식별자 추출
- 허용된 X main 번들 URL 검증
- API 응답 미디어 탐색과 중복 제거
- 최고 비트레이트 MP4 선택
- DOM 비디오와 API 미디어 매칭

브라우저에서는 `globalThis.ArcaDLShared`, Node 테스트에서는 CommonJS export를 사용한다.

### `src/content/content.js`

호스트와 사이트 설정을 연결하고 DOM에서 미디어 및 인라인 UI 대상을 수집한다. `siteAdapters` 레지스트리에 현재 두 엔진이 연결된다.

- `arca_article`: 아카라이브 본문 이미지, GIF, 비디오 및 목록 진입점
- `tweet_media`: X/Twitter 트윗 단위 이미지, GIF, 비디오와 액션 바

### `src/content/twitter-resolver.js`

X/Twitter 미디어 URL을 다음 순서로 해석한다.

1. DOM에 노출된 `video.twimg.com` 직접 URL
2. 현재 X/Twitter 페이지 세션을 이용한 상세 요청
3. background guest GraphQL 요청

GIF는 X/Twitter에서 MP4로 전달될 수 있으므로 UI 미디어 타입과 실제 저장 확장자를 구분한다. DOM이 `blob:` URL만 제공하면 현재 페이지가 사용한 `abs.twimg.com/responsive-web/.../main.*.js` URL을 제한된 힌트로 background에 전달한다.

### `src/content/content-ui.js`

- Shadow DOM 선택 패널과 필터
- X/Twitter 인라인 버튼 수명주기
- 선택, 기존 다운로드, 추가, 취소 상태
- 로컬 Blob 저장과 background 다운로드 요청 조정
- 진행 상태와 실패 이력 표시

X/Twitter 토큰이나 GraphQL 구조는 이 파일에서 직접 처리하지 않는다.

### `src/background/twitter-api.js`

X/Twitter 웹 번들에서 현재 bearer token과 `TweetResultByRestId` operation ID를 읽고 guest token을 활성화한다. 400 응답의 feature/variable 힌트와 401, 403, 404 갱신 경로를 처리한다. 큐나 파일명 상태에는 관여하지 않는다.

### `src/background/background.js`

다음 상태를 하나의 다운로드 상태 머신으로 관리한다.

- 사이트별 동시성 및 항목 간 지연
- 대기열 추가, 취소, 항목 제거
- 자동 재시도와 수동 복구
- 중복 및 기존 다운로드 검사
- 실패 이력
- `chrome.downloads` 이벤트와 상태 영속화
- content script 메시지 라우팅

네트워크 해석과 순수 함수만 외부 모듈로 분리하고 큐 상태를 여러 모듈에서 직접 변경하지 않는다.

## 메시지와 데이터 흐름

```text
content.js ──수집 결과──> content-ui.js
twitter-resolver.js ──직접/세션 해석──> content-ui.js
content-ui.js ──다운로드·상태 요청──> background.js
background.js ──X 상세 요청──> background/twitter-api.js
background.js ──상태 브로드캐스트──> content-ui.js
```

## 중복 제거 기준

- 다운로드 큐는 정리된 폴더와 basename 조합을 우선 사용한다.
- 같은 실행에서 중복된 항목을 추가하지 않는다.
- 브라우저 다운로드 기록을 확인해 이미 받은 파일을 UI에 표시한다.
- `sourceIndex`는 안정적인 파일 순서와 접두어 생성에 유지한다.

## 검증

저장소 루트에서 실행한다.

```powershell
node tools/test-validate-extension.js
node tools/test-media-utils.js
node tools/test-twitter-api.js
node tools/validate-extension.js
```

- validator 자체의 성공·누락·문법 오류 동작
- manifest와 site config JSON
- manifest 및 `importScripts` 참조 파일
- 모든 런타임·도구 JavaScript 문법
- 파일명과 X/Twitter 미디어 선택 순수 함수
- mock `fetch`를 사용하는 bearer·guest token·GraphQL 요청 흐름

브라우저 검증은 아카라이브 본문, X/Twitter 트윗, 미디어 뷰어, 진행·취소·재시도 동작을 별도로 확인한다. 새 사이트 회귀 데이터는 개인 식별 정보가 없는 최소 합성 fixture로 작성한다.

## 새 사이트 추가 순서

1. `src/config/site-config.default.json`에 host, parser engine, UI 위치를 정의한다.
2. `src/manifest.json`의 matches와 host permissions를 최소 범위로 갱신한다.
3. 기존 엔진으로 표현할 수 없을 때만 새 adapter 또는 resolver를 추가한다.
4. 합성 fixture와 순수 함수 테스트를 먼저 추가한다.
5. README, 개인정보 처리방침, 배포 체크리스트, AGENTS의 지원 범위를 맞춘다.
