# 제품 작업 화면 참고 · 2026-11-05

사용자는 해커톤의 실제 택시 배차는 필수 범위가 아니며, 현재 화면의 AI slop을 줄이기 위해 좋은 소프트웨어 여러 곳을 살펴 수정하라고 요청했다. 이 문서는 공개 제품 이미지에서 관측한 구성과 혼디에 적용할 원칙을 기록한다. 로그인 뒤 내부 제품을 사용한 조사나 해당 회사의 사용자 연구 결과가 아니다.

| 공식 자료 | 실제 관측 범위 | 혼디에 적용할 점 |
| --- | --- | --- |
| [Linear Inbox](https://linear.app/docs/inbox) | 공식 도움말·그 안의 Inbox와 옵션 화면. 제목·변경 이유·상태·시각을 행으로 정렬하고 세부 조작을 문맥 안에 둠 | 오른쪽 단계와 처리 기록은 반복 카드 대신 선택 행·보조 문장·상태로 정돈 |
| [Things Today](https://culturedcode.com/things/support/articles/4001304/) | 공식 지원문서의 Mac 제품 이미지. 흰 작업면, 옅은 탐색면, 작업명과 회색 소속, 현재/나중 구획 | 현재 할 일 한 문장을 대표 제목으로 두고 담당·세부 설명의 위계를 낮춤. 구획은 여백과 선으로 표현 |
| [Attio Tasks](https://attio.com/help/reference/productivity-collaborating/tasks) | 공식 도움말의 홈/record Tasks 이미지. 제목 아래 날짜·연결 대상을 작게 표시하고 목록 머리에 주 행동을 한 번 배치 | 환자/방문 맥락과 실제 할 일을 분리하고 같은 작업의 중복 제목·버튼을 줄임 |
| [Attio Records](https://attio.com/help/reference/managing-your-data/records/create-and-view-records)·[기록 화면 변경 안내](https://attio.com/changelog/2026/redesigned-record-pages) | 대상 속성과 활동/메일/노트/할 일의 탭 구분. Overview에는 작은 Highlights 카드도 존재함 | 대상 정보와 업무 상세의 역할을 구분. 전체 제품이 카드가 없다고 일반화하지 않음 |
| [Front Inbox](https://help.front.com/en/articles/2257) | 공식 설명과 제품 이미지. 열린 작업·나중·완료·초안 등의 업무 상태를 탐색으로 구분 | 읽기 이동·작업 상태·요청 실행의 수준을 분명히 하며 낯선 장식을 추가하지 않음 |

Attio 홈은 제품을 소개하는 마케팅 페이지로 구분했다. One Medical technology 페이지는 브라우저403으로 시각 참고에서 제외했다. Notion Mail도 원문/실제 화면 수집을 완료하지 않아 채택 근거로 사용하지 않았다. 의료 서비스의 실제 치료·접수 흐름을 이 업무 앱들의 작업 관리 패턴으로 대체한 것은 아니다.

## 수집과 한계

지정된 insane-search를 각 URL에 먼저 실행했으나 curl_cffi·engine의 Chrome 등 선택 의존성이 없어 본문 수집에 실패했다. JSON/trace에 grid_exhausted 및 Playwright MCP 후속 경로가 남았으며 이 세션에는 해당 MCP가 없어 기존 설치 Playwright/Chromium을 별도 fallback으로 사용했다. engine이나 MCP가 성공했다고 기록하지 않는다. 브라우저에서 위 공식 자료는200·본문·PNG를 확보했다. 제품을 로그인해 직접 조작한 것이 아니라 공식 공개 이미지의 시각 구성과 설명을 관찰했다.

조사 원본은 /tmp/hondi-reference-20261105/ 및 /tmp/hondi-root-reference-20261105/에 있다. 외부 제품 PNG/폰트/아이콘/로고·화면 코드는 혼디 앱이나 제출물에 복사하지 않는다. 조사 날짜와 출처는 이 문서로 제출하며 실제 제출 화면 캡처는 혼디 자체 화면이다.

## 이번 변경의 기준

큰 프레임 안에 입력·안내·요약의 둥근 상자가 반복되고, 환자 제목/섹션 제목/작업 제목이 경쟁하던 구성을 교체한다. 중앙에는 구체적인 현재 할 일을 먼저 보이고, 오른쪽은 네 단계의 간결한 행, 왼쪽은 대상·선택 설정·보조 도구로 정돈한다. 텍스트 초안 삽입은 작은 inline 안내로 끝내고 개인정보 전체 창을 자동으로 열지 않는다. 전체 고지·음성 피드백·초점·초안·읽기 보존은 유지한다.

100dvh·단일 입력과 네 단계·혼디 PNG·Pretendard·주황 이름/핵심 행동·초록 탐색/상태·은은한 제주 배경은 사용자 요구로 유지한다. 외부 제품의 작은 조작 목표·잘린 긴 텍스트·직접 완료 체크박스·CRM 전체 메뉴는 가져오지 않는다. 색/형태만 닮게 하는 것이 아니라 정보 위계·행동 수준·작업면의 구성을 참고한다. 상세 범위는 [계약](../docs/product-ui-redesign-contract.md)을 따른다.
