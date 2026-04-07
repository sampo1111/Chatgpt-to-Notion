# AI to Notion

ChatGPT나 Gemini 답변을 Notion으로 옮길 때 수식이 깨지는 문제를 줄여 주는 크롬 확장 프로그램입니다.

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
- Notion
  - `https://www.notion.so/*`
  - `https://notion.so/*`

## 빠른 시작

1. 크롬에서 이 확장을 설치합니다.
2. Notion Integration Token을 팝업에 저장합니다.
3. ChatGPT 또는 Gemini에서 `Copy for Notion`을 누릅니다.
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

1. ChatGPT 또는 Gemini 답변 아래 `Copy for Notion` 버튼을 누릅니다.
2. Notion에서 원하는 블록에 커서를 둡니다.
3. `Ctrl+V`를 누르거나 `Paste to Notion` 버튼을 누릅니다.

### 답변 일부만 복사

1. 답변에서 원하는 부분만 드래그합니다.
2. 선택 영역 옆에 뜨는 `Copy selection` 버튼을 누릅니다.
3. Notion에 가서 붙여넣습니다.

### 붙여넣기 취소

- 붙여넣는 중 버튼이 `Pasting... Click to cancel` 상태가 되면 다시 눌러 중단할 수 있습니다.

## 팝업 옵션 설명

팝업의 `옵션`을 열면 아래 항목을 조절할 수 있습니다.

- `기능 활성화`
  - 복사와 붙여넣기 기능 전체를 한 번에 켜고 끕니다.
  - 꺼지면 아래 옵션들도 함께 비활성화됩니다.
- `복사 버튼`
  - ChatGPT/Gemini 답변 옆의 `Copy for Notion` 버튼 표시 여부
- `Paste to Notion 버튼`
  - Notion 우하단의 `Paste to Notion` 버튼 표시 여부
- `페이지 버튼 크기`
  - ChatGPT, Gemini, Notion 페이지에 보이는 확장 버튼 크기를 `50% ~ 150%` 범위에서 조절

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
