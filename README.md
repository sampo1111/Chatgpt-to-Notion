# AI to Notion

ChatGPT와 Gemini 답변을 Notion으로 옮길 때, 수식을 일반 텍스트로 깨뜨리지 않고 최대한 Notion의 네이티브 블록 형태로 넣어 주는 크롬 확장 프로그램입니다.

## 주요 기능

- ChatGPT와 Gemini 답변에 `Copy for Notion` 버튼을 추가합니다.
- 답변 일부를 드래그하면 선택 영역 옆에 `Copy selection` 버튼이 나타납니다.
- 인라인 수식과 수식 블록을 구분해서 Notion용 payload로 복사합니다.
- Notion에서 붙여넣을 때 equation rich text와 equation block으로 최대한 복원합니다.
- 붙여넣는 양이 많을 때 요청을 자동으로 분할합니다.
- `Pasting...` 상태에서 버튼을 다시 누르면 진행 중인 삽입을 중단할 수 있습니다.

## 지원 사이트

- ChatGPT
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`
- Gemini
  - `https://gemini.google.com/*`
- Notion
  - `https://www.notion.so/*`
  - `https://notion.so/*`

## 설치 방법

1. 크롬에서 `chrome://extensions`로 이동합니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 폴더를 선택합니다.

## Notion 설정

1. Notion에서 Integration을 생성합니다.
2. Integration Token을 복사합니다.
3. 확장 팝업을 열고 토큰을 저장합니다.
4. 대상 Notion 페이지를 해당 Integration과 공유합니다.

## 사용 방법

1. ChatGPT 또는 Gemini에서 답변 전체를 복사하려면 `Copy for Notion` 버튼을 누릅니다.
2. 답변 일부만 옮기고 싶다면 드래그한 뒤 `Copy selection` 버튼을 누릅니다.
3. Notion 페이지에서 원하는 위치의 블록 안에 커서를 둡니다.
4. `Ctrl+V`로 붙여넣거나 우하단 `Paste to Notion` 버튼을 누릅니다.
5. 붙여넣는 중 `Pasting... Click to cancel` 상태가 보이면 같은 버튼을 다시 눌러 중단할 수 있습니다.

## 버튼 켜기/끄기

확장 팝업에서 아래 기능을 각각 켜고 끌 수 있습니다.

- `복사 버튼`
  - ChatGPT/Gemini 답변 옆의 복사 버튼 표시 여부
- `Notion 붙여넣기 기능`
  - Notion의 붙여넣기 가로채기와 Paste 버튼 동작 여부

## 동작 방식

1. 소스 사이트용 content script가 답변 DOM을 읽습니다.
2. `converter.js`가 답변을 내부 block 구조로 변환합니다.
3. 변환된 결과를 클립보드와 `chrome.storage.local`에 저장합니다.
4. Notion content script가 paste 이벤트를 가로채 payload를 복원합니다.
5. `background.js`가 Notion API 형식으로 변환해 현재 커서가 있는 블록 뒤에 삽입합니다.

## 파일 구성

- `manifest.json`
  - 확장 설정, 권한, content script 등록
- `source-providers.js`
  - ChatGPT/Gemini 사이트별 provider 정의
- `converter.js`
  - 답변 DOM을 공통 block 구조로 변환
- `content.js`
  - 소스 사이트에서 복사 버튼, 선택 버튼, 복사 처리 담당
- `notion-content.js`
  - Notion에서 붙여넣기 감지, 현재 블록 추적, 붙여넣기 취소 처리
- `background.js`
  - 설정 저장, Notion API 호출, 요청 분할, 재시도, 취소 처리
- `popup.html`, `popup.js`, `popup.css`
  - 팝업 UI와 설정 화면
- `styles.css`
  - 버튼과 토스트 스타일

## 현재 제한 사항

- Gemini 웹앱 DOM은 자주 바뀔 수 있어서, 답변 버튼 위치나 선택자 일부는 이후 조정이 필요할 수 있습니다.
- 커서가 들어 있는 블록 `뒤`에 삽입하는 방식이며, 문단 한가운데를 쪼개 넣지는 않습니다.
- Notion 공개 API 제약 때문에 매우 복잡한 블록은 단순화될 수 있습니다.
- 이미 Notion에 삽입이 끝난 블록까지 되돌리지는 못하고, 진행 중인 추가 요청만 취소합니다.
