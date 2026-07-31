# Publishing Checklist

공개 저장소와 Chrome Web Store 배포 전에 확인하는 체크리스트입니다.

## 자동 검증

- [ ] `node tools/test-validate-extension.js`
- [ ] `node tools/test-media-utils.js`
- [ ] `node tools/test-twitter-api.js`
- [ ] `node tools/validate-extension.js`
- [ ] 세 프로젝트 스킬이 `quick_validate.py`를 통과함

## 브라우저 기능

- [ ] `arca.live` 본문에서 이미지, GIF, 비디오가 수집됨
- [ ] 아카라이브 목록과 본문 진입점이 표시됨
- [ ] X/Twitter 트윗과 미디어 뷰어에 다운로드 버튼이 표시됨
- [ ] 여러 이미지, GIF, 직접 MP4, `blob:` 비디오 해결 경로가 동작함
- [ ] 선택, 다운로드 중 추가, 진행률, 취소가 동작함
- [ ] 중복·기존 파일 표시와 실패 항목 재시도가 동작함
- [ ] 사이트별 폴더 옵션과 파일 순서가 유지됨

## 권한과 정책

- [ ] `src/manifest.json`의 permissions와 host permissions가 최소 범위인지 검토함
- [ ] `README.md` 권한 설명이 manifest와 일치함
- [ ] `PRIVACY_POLICY.md`가 Arca, X/Twitter API·번들, 원격 설정 요청을 설명함
- [ ] 스토어 privacy fields가 실제 저장·전송 동작과 일치함
- [ ] 접근 제한이나 유료·비공개 콘텐츠 우회를 암시하는 문구가 없음

## 공개 저장소 안전성

- [ ] 실제 게시물 HTML, HAR, 브라우저 프로필, 다운로드 기록이 없음
- [ ] 실사용 cookie, token, API key, session 값이 없음
- [ ] 개인 로컬 사용자 경로가 없음
- [ ] 공개 연락처와 비공개 개인정보를 구분해 검토함
- [ ] `.gitignore`가 `dist/`, 브라우저 프로필, ZIP, key 파일을 제외함
- [ ] 삭제한 민감 파일이 Git 이력에 들어간 적이 없는지 확인함
- [ ] `git diff --check`와 `git status --short`를 확인함

## 배포 ZIP

- [ ] `pwsh -File tools/package-extension.ps1` 실행
- [ ] `dist/arca-image-downloader-v<버전>.zip` 생성
- [ ] ZIP 루트에 `manifest.json`이 있음
- [ ] ZIP에 최상위 `src/` 디렉터리가 없음
- [ ] ZIP에 README, docs, tools, editor 설정, 프로젝트 스킬이 없음
- [ ] Chrome에서 생성된 ZIP 또는 동일한 `src/`를 설치해 동작 확인

## 스토어 메타데이터

- [ ] 이름, 설명, 지원 사이트, 스크린샷이 현재 기능과 일치함
- [ ] 개인정보 처리방침 URL과 지원 URL이 공개 접근 가능함
- [ ] 버전이 `src/manifest.json`과 일치함
- [ ] 공개 전 테스트 배포 또는 trusted tester 설치를 확인함

## 운영 보안

- [ ] 개발자 계정에 안전한 복구 수단과 다중 인증이 설정됨
- [ ] 원격 사이트 설정을 사용하는 경우 수정 권한이 최소 인원으로 제한됨
- [ ] push 또는 공개 전 마지막 검증 결과를 다시 확인함
