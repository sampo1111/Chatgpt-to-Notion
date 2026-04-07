# AI to Notion

ChatGPT나 Gemini 답변을 Notion으로 옮길 때 수식이 깨지는 문제를 줄여 주는 크롬 확장 프로그램입니다.

기존에는 `ε`, `\cdot`, `a+b=b+a` 같은 수식이 일반 텍스트처럼 깨지거나, 줄바꿈이 이상하게 들어가서 직접 다시 정리해야 했습니다.  
이 확장은 답변을 복사한 뒤 Notion에 붙여넣을 때 인라인 수식과 수식 블록을 최대한 Notion 형식에 맞게 복원해 줍니다.

## 이런 분께 추천합니다

- ChatGPT 답변을 강의노트처럼 Notion에 정리하는 분
- 선형대수, 해석학, 확률통계처럼 수식이 많은 내용을 자주 옮기는 분
- 답변 일부만 드래그해서 깔끔하게 복사하고 싶은 분

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

## 평소 사용하는 방법

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
- 붙여넣기 결과가 크게 망가졌을 때
- 방금 넣은 내용을 빠르게 걷어내야 할 때

주의:
- Notion API 특성상 블록을 한 번에 지우지 못하고 여러 번 나눠 지웁니다.
- 그래서 일반적인 `Ctrl+Z`처럼 빠르지 않을 수 있습니다.
- 마지막 붙여넣기 1회만 되돌릴 수 있습니다.

## 자주 헷갈리는 점

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

### 3. 수동 `Ctrl+C`로 일부 복사하면 왜 깨졌었나요?

웹페이지 수식은 내부 DOM이 여러 조각으로 나뉘어 있어서, 그냥 복사하면 `ε`, `X`, `n`, 기호들이 줄줄이 분해되는 경우가 있습니다.  
그래서 부분 복사는 `Copy selection` 버튼을 사용하는 것이 가장 안정적입니다.

## 잘 안 될 때 체크할 것

- 확장을 새로고침한 뒤 ChatGPT, Gemini, Notion 탭도 같이 새로고침했는지
- Notion Token을 저장했는지
- 대상 Notion 페이지를 Integration과 공유했는지
- `기능 활성화`가 켜져 있는지
- ChatGPT/Gemini/Notion이 지원 도메인에서 열려 있는지

## 현재 제한 사항

- Gemini 웹앱 DOM은 자주 바뀔 수 있어서 버튼 위치나 감지 방식은 이후 조정이 필요할 수 있습니다.
- Notion 공개 API 제약 때문에 매우 복잡한 블록은 단순화될 수 있습니다.
- 커서가 들어 있는 블록 `뒤`에 삽입하는 방식이며, 문단 한가운데를 쪼개 넣지는 않습니다.
- 진행 중인 붙여넣기는 취소할 수 있지만, 이미 Notion에 들어간 블록은 자동으로 되돌려지지 않습니다.
- `응급 Undo`는 마지막 붙여넣기 기준으로만 동작합니다.

## 한 줄 요약

`AI 답변을 Notion에 수식 안 깨지게 옮기고 싶을 때 쓰는 확장`입니다.
