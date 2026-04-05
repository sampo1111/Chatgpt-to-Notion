# ChatGPT to Notion

ChatGPT 답변을 Notion으로 옮길 때, 수식을 일반 텍스트로 깨뜨리지 않고 최대한 Notion의 네이티브 블록 형태로 넣어 주는 크롬 확장 프로그램입니다.

## 주요 기능

- ChatGPT 답변에 `Copy for Notion` 버튼을 추가합니다.
- 답변을 구조화된 블록으로 변환합니다.
  - 인라인 수식
  - 수식 블록
  - 제목
  - 문단
  - 리스트
  - 코드 블록
- 구조화된 payload를 클립보드와 확장 저장소에 함께 보관합니다.
- Notion에서 붙여넣기 시 payload를 읽어 Notion API로 블록을 추가합니다.
- 가능하면 인라인 수식은 Notion의 equation rich text로, 수식 블록은 equation block으로 넣습니다.

## 설치 방법

1. 크롬에서 `chrome://extensions` 로 이동합니다.
2. 우측 상단에서 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 폴더를 선택합니다.

## Notion 설정

1. Notion에서 Integration을 생성합니다.
2. Integration Token을 복사합니다.
3. 확장 프로그램 팝업을 엽니다.
4. Token을 붙여넣고 `Save`를 누릅니다.
5. Integration에 `read content`, `insert content` 권한이 있는지 확인합니다.
6. 내용을 넣을 Notion 페이지를 해당 Integration과 공유합니다.

## 사용 방법

1. ChatGPT 페이지에서 원하는 답변의 `Copy for Notion` 버튼을 누릅니다.
2. Notion 페이지로 이동합니다.
3. 원하는 위치의 블록 안에 커서를 둡니다.
4. `Ctrl+V`로 붙여넣거나, 우하단의 `Paste ChatGPT` 버튼을 누릅니다.

## 동작 방식

1. ChatGPT 쪽 content script가 답변 DOM을 읽습니다.
2. `converter.js`가 답변을 내부 block 구조로 변환합니다.
3. `content.js`가 이 구조를 클립보드와 `chrome.storage.local`에 저장합니다.
4. Notion 쪽 content script가 paste 이벤트를 가로챕니다.
5. payload를 복원한 뒤 background script에 전달합니다.
6. `background.js`가 Notion API 형식으로 변환해 현재 커서가 있는 블록 뒤에 추가합니다.

## 파일 구성

- `manifest.json`
  확장 프로그램 설정, 권한, content script, background, popup 등록
- `converter.js`
  ChatGPT 답변 DOM을 내부 block 구조로 변환
- `content.js`
  ChatGPT 페이지에 복사 버튼을 주입하고 payload를 클립보드에 기록
- `notion-content.js`
  Notion 페이지에서 paste 감지, 커서 위치 추적, 기본 붙여넣기 차단, payload 복원
- `background.js`
  Notion Token 저장, Notion API 호출, block 변환, 요청 분할, 재시도 처리
- `popup.html`, `popup.js`, `popup.css`
  확장 팝업 UI와 설정 화면
- `styles.css`
  ChatGPT/Notion 버튼과 toast 스타일

## 현재 제한 사항

- 삽입 위치는 “현재 커서가 들어 있는 블록 바로 뒤” 기준입니다.
- Notion이 현재 블록을 감지하지 못하면 페이지 끝에 추가될 수 있습니다.
- 페이지의 맨 첫 블록 앞에 삽입하는 것은 공개 API 제약이 있습니다.
- 표나 이미지 같은 일부 복잡한 블록은 단순화된 형태로 들어갈 수 있습니다.
- ChatGPT 웹과 Notion 웹에서 동작하는 것을 기준으로 만들었습니다.

