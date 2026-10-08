# Chatgpt to Notion

ChatGPT, Gemini, Claude 답변을 Notion으로 옮길 때 수식이 깨지는 문제를 줄여 주는 크롬 확장 프로그램입니다.

기존에는 `ε`, `\cdot`, `a+b=b+a` 같은 수식이 일반 텍스트처럼 깨지거나, 줄바꿈이 이상하게 들어가서 직접 다시 정리해야 했습니다.  
이 확장은 답변을 복사한 뒤 Notion에 붙여넣을 때 인라인 수식과 수식 블록을 최대한 Notion 형식에 맞게 복원해 줍니다.

## 이런 분께 추천합니다

- ChatGPT 답변을 강의노트처럼 Notion에 정리하는 분
- 선형대수, 해석학, 확률통계처럼 수식이 많은 내용을 자주 옮기는 분

## 지원 사이트

- ChatGPT
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`
- Gemini
  - `https://gemini.google.com/*`
- Claude
  - `https://claude.ai/*`
- Notion
  - `https://www.notion.so/*`
  - `https://notion.so/*`
  - `https://notion.com/*`
  - `https://www.notion.com/*`
  - `https://app.notion.com/*`

## 빠른 시작

1. 크롬에서 이 확장을 설치합니다.
2. Notion Integration Token을 팝업에 저장합니다.
3. ChatGPT, Gemini 또는 Claude에서 `Copy for Notion`을 누릅니다.
4. Notion에서 `Ctrl+V`를 누르거나 `Paste to Notion` 버튼을 누릅니다.

## 설치 방법

1. 크롬에서 `chrome://extensions`로 이동합니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 폴더를 선택합니다.

## 처음 한 번만 필요한 Notion 설정

1. Notion에서 Integration을 생성합니다.
2. Integration Token을 복사합니다.
3. 확장 팝업을 열고 토큰을 저장합니다.
4. 붙여넣을 Notion 페이지를 해당 Integration과 공유합니다.

중요:
- 토큰을 저장하지 않으면 Notion에 실제 블록으로 삽입할 수 없습니다.
- 페이지를 Integration과 공유하지 않으면 붙여넣기나 Undo가 실패할 수 있습니다.

## 사용법

### 답변 전체 복사

1. ChatGPT, Gemini 또는 Claude 답변 아래 `Copy for Notion` 버튼을 누릅니다.
2. Notion에서 원하는 블록에 커서를 둡니다.
3. `Ctrl+V`를 누르거나 `Paste to Notion` 버튼을 누릅니다.

### 답변 일부만 복사

1. 답변에서 원하는 부분만 드래그합니다.
2. 선택 영역 옆에 뜨는 `Copy selection` 버튼을 누릅니다.
3. Notion에 가서 붙여넣습니다.

### 붙여넣기 취소

- 붙여넣는 중 버튼이 `Pasting... Click to cancel` 상태가 되면 다시 눌러 중단할 수 있습니다.

### 도식과 차트 복사 (0.4.4)

- `Copy for Notion`으로 복사하면 박스형 도식, SVG, canvas 차트를 자동으로 PNG 이미지로 변환합니다. 도식 바깥의 본문과 수식은 기존처럼 편집 가능한 Notion 블록으로 유지됩니다.
- ChatGPT의 `data-d-component` 기반 도식과 중간 래퍼가 있는 박스 배치를 지원합니다. PDF 출처 칩과 출처 UI는 복사에서 제외하며, 일반 본문에 적힌 파일명과 PDF 링크는 유지합니다.
- CDS 거래구조처럼 안쪽 박스에 테두리가 없어도, 바깥 프레임 안의 ChatGPT 다중 열 배치를 하나의 이미지로 복사합니다. 일반 HTML에서도 다중 열과 연결 화살표가 있는 도식을 감지합니다.
- `<img>`로 표시되는 SVG 그래프도 PNG로 변환하며, ChatGPT의 세로 단계·화살표 도식을 함께 캡처합니다. 이전 버전에서 복사한 SVG 그래프는 업데이트 후 답변을 다시 복사해야 합니다.
- 도식 아래의 설명 캡션은 이미지에서 분리해 Notion 이미지 캡션으로 옮깁니다. 설명이 없는 도식에는 기본 `Diagram` 문구를 넣지 않습니다.
- 선택 영역에 도식 일부가 포함되면 해당 도식 전체를 복사합니다. 도식 안의 글자는 이미지의 일부이므로 Notion에서 직접 편집할 수 없습니다.
- 이미지는 복사할 때가 아니라 Notion에 붙여넣을 때 기존 Integration Token으로 업로드됩니다. 별도 이미지 호스팅 서비스는 사용하지 않습니다.
- 캡처 이미지는 한 장당 2 MiB, 한 번에 총 4 MiB까지 지원합니다. 너무 큰 도식은 나누어 복사하세요.
- 브라우저 보안상 접근할 수 없는 외부 사이트 또는 sandbox iframe은 자동 캡처하지 못합니다. 이때 오류를 표시하며, 해당 도식은 별도로 이미지로 저장해서 넣어야 합니다. 모든 웹 위젯이 자동 감지되는 것은 아닙니다.
- 업데이트 후 `chrome://extensions`에서 확장을 새로고침하고, 열려 있던 AI 페이지와 Notion 페이지도 새로고침한 뒤 다시 복사하세요.

## 팝업 옵션 설명

팝업의 `옵션`을 열면 아래 항목을 조절할 수 있습니다.

- `기능 활성화`
  - 복사와 붙여넣기 기능 전체를 한 번에 켜고 끕니다.
  - 꺼지면 아래 옵션들도 함께 비활성화됩니다.
- `복사 버튼`
  - ChatGPT/Gemini/Claude 답변 옆의 `Copy for Notion` 버튼 표시 여부
- `Paste to Notion 버튼`
  - Notion 우하단의 `Paste to Notion` 버튼 표시 여부
- `페이지 버튼 크기`
  - ChatGPT, Gemini, Claude, Notion 페이지에 보이는 확장 버튼 크기를 `50% ~ 150%` 범위에서 조절

## 응급 Undo

팝업 안에는 `응급 Undo` 버튼이 있습니다.

이 기능은 다음 상황에서만 쓰는 것을 권장합니다.
- 붙여넣기 결과로 인해 문서 구조가 망가졌을 때
- 일반적인 상황에선 그냥 직접 삭제하시면 됩니다

주의:
- Notion API 특성상 블록을 한 번에 지우지 못하고 여러 번 나눠 지웁니다.
- 그래서 일반적인 `Ctrl+Z`처럼 빠르지 않을 수 있습니다.
- 마지막 붙여넣기 1회만 되돌릴 수 있습니다.

## Q&A

### 1. ChatGPT 계정과 Notion 계정이 달라도 되나요?

됩니다.  
중요한 것은 계정이 아니라 브라우저 환경입니다.

### 2. ChatGPT와 Notion이 다른 크롬 프로필에 있어도 되나요?

됩니다. 다만 아래처럼 써야 합니다.

- ChatGPT가 있는 프로필에도 확장 설치
- Notion이 있는 프로필에도 확장 설치
- Notion이 있는 프로필에 토큰 저장
- ChatGPT 쪽에서 복사
- Notion 쪽에서 붙여넣기

## 개발 및 검증

수식 검증기와 도식 캡처 코드는 각각 `vendor/math-renderer.js`, `vendor/diagram-capture.js`에 포함되어 있으며, 실행 중 외부 코드를 다운로드하지 않습니다.
`src`의 코드를 수정했다면 다음 명령으로 두 번들을 다시 생성하고 테스트합니다.

```sh
npm ci
npm run build
npm test
npm run test:browser
```

배포 시 `vendor` 폴더와 라이선스 파일을 함께 포함해야 합니다. `node_modules`는 개발용이며 확장 설치에 필요하지 않습니다.

브라우저 테스트는 설치된 Chrome을 사용합니다. 로컬 테스트 화면에서 캡처·선택 복사를 검증하고 `tests/artifacts`에 데스크톱·모바일 이미지를 생성합니다. Notion API 테스트는 모의 요청을 사용하며 실제 문서를 수정하지 않습니다.

