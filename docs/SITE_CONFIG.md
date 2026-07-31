# Site Config

사이트별 DOM 파싱, 다운로드 대기열, UI 배치 설정은 `src/config/site-config.default.json`에서 관리합니다.

## 목적

- DOM selector와 URL 변환 규칙을 공통 실행 흐름에서 분리합니다.
- 사이트별 동시성과 버튼 위치를 JSON으로 조정합니다.
- 새 사이트가 기존 엔진으로 표현되는 경우 런타임 코드를 늘리지 않습니다.
- 선택적으로 GitHub Gist 또는 raw URL의 설정을 `site.id` 단위로 병합할 수 있습니다.

## 로딩 구조

- 번들 기본값: `src/config/site-config.default.json`
- 로더와 캐시: `src/background/background.js`
- 원격 주소 상수: `DEFAULT_SITE_CONFIG_REMOTE_URL`
- 저장된 세션 키: `siteConfigPayload`

번들 설정을 먼저 읽고, 상수에 유효한 원격 URL이 지정된 경우 사이트 항목을 덮어씁니다. 원격 요청이나 검증이 실패하면 번들 설정을 사용합니다. 배포본의 기본 원격 주소는 비어 있습니다.

## 공통 사이트 형식

```json
{
  "version": 1,
  "sites": [
    {
      "id": "example.com",
      "hosts": ["example.com"],
      "parser": {
        "engine": "adapter_name"
      },
      "download": {
        "parallelism": 1,
        "prefixOrderInFolder": false,
        "interDownloadDelayMs": 0
      },
      "ui": {
        "mode": "panel"
      }
    }
  ]
}
```

- `id`: 저장 옵션과 설정 병합에 사용하는 안정적인 키
- `hosts`: 현재 페이지와 설정을 연결하는 호스트 목록
- `parser.engine`: `content.js`에서 선택하는 adapter
- `download.parallelism`: 해당 사이트의 최대 동시 다운로드 수
- `download.prefixOrderInFolder`: 폴더 내부 파일명 순서 접두어 사용 여부
- `download.interDownloadDelayMs`: 항목 시작 사이의 최소 지연
- `ui.mode`: 선택 패널 또는 인라인 UI 모드

## 현재 엔진

### `arca_article`

- `.fr-view.article-content` 본문을 기준으로 수집
- 원본 이미지 URL과 GIF·비디오 분리
- `.arca-emoticon`, `.emoticon` 제외
- 목록 페이지의 게시글별 다운로드 진입점
- 기본 동시성 `2`, 폴더 내부 순서 접두어 사용

### `tweet_media`

- `article[data-testid="tweet"]` 단위 수집
- 상태 경로에서 계정, 트윗 ID, 미디어 번호 추출
- `pbs.twimg.com` 이미지의 원본 URL 변환
- 비디오 poster와 source 후보 해석
- 트윗 액션 바 및 미디어 dialog의 인라인 버튼
- 기본 동시성 `1`, 항목 간 지연 `700ms`

## 원격 설정 운영

- `gist.github.com` 페이지 주소가 아니라 허용된 raw HTTPS 주소만 사용합니다.
- 부분 수정이라도 `site.id`에 해당하는 완전한 사이트 객체를 제공합니다.
- JSON 설정은 기존 adapter가 이해하는 값만 바꿀 수 있으며 임의 JavaScript를 실행하지 않습니다.
- 허용 호스트를 추가하려면 원격 설정뿐 아니라 manifest, 개인정보 처리방침, 공개 문서도 함께 변경해야 합니다.

## 검증

```powershell
node tools/test-validate-extension.js
node tools/validate-extension.js
```

validator는 번들 JSON 파싱, `sites` 배열, manifest 참조, JavaScript 문법을 확인합니다. 미디어 변환과 X/Twitter API 흐름은 다음 합성 테스트로 확인합니다.

```powershell
node tools/test-media-utils.js
node tools/test-twitter-api.js
```
