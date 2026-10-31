disposition: fix

입력·한계: 사용자 지정 code-led 구성으로 승인 comp·QUALITY BAR 카드가 없으며, CLI context/detect 종료 126은 성공으로 간주하지 않았다. 아래 렌더 평가는 제공 PNG 직접 관찰과 지정 소스 표본 검토이고, 검사 수치는 통합 담당자가 현재 source hash와 대조해 전달한 fresh 결과다. 실제 공개 모델·DynamoDB 진행·배포·제출 ZIP·실기기 음성/키보드는 이 검토에서 확인하지 않았다.

## persistence

fail — PRODUCT.md·README·docs/preparation-board-contract.md에는 선택한 네 작업창이 기록돼 있다. 그러나 기존 DESIGN.md의 ‘레이아웃과 탐색’은 아직 가운데 대화와 우측 단일 floating 요약을 주 구성으로 설명한다. 연장 구현의 현재 화면과 맞도록 해당 문단과 sidecar composition을 갱신해야 한다. 사용자 지정 2×2·기존 브랜드 계승이 기준이므로 별도 comp·랜덤 seed를 다시 요구하지 않는다.

근거: 현재 통합 기준 e85406b, source/runtime 지문 `15a7315076aa969ee8866d32d982b8c94ba3076fd78af68f4b43a111c5acdf30`. 통합 담당자가 fresh unit 347/347, conversation 173/173, journey 222/222(실제 keyless preview 14·normal POST 0), workspace 47/47, board 104/104, eval 51/51 및 build:agent 성공과 네 browser proof의 errors=[]·source hash 일치를 보고했다. 이를 실제 유료 모델·기관 처리·공개 DDB 검증으로 확대하지 않는다.

필수 캡처 여덟 개를 모두 열어 확인했다: `.impeccable/review/board/{1440x900,1280x800,390x844,360x780,390x500,768x512}-initial.png`, `desktop-progress-final.png`, `mobile-cancel-final.png`. 검거나 빈 화면·다른 경로·상단 누락은 없다. 초기 캡처는 지정 viewport에서 full-page로 저장돼 이미지의 전체 높이가 viewport보다 길다(예: 390×500 초기 → 390×864). 짧은 화면의 문서 스크롤을 보여주는 유효한 증거다. 추가로 두 answer-table 및 normal/time_changed/call_ai_declined preview PNG를 직접 열었다. 이후 보충 중인 expanded/missing_record 캡처는 아직 판정 근거에 포함하지 않았다.

## fidelity

| 요소·계약 약속 | 판정 | 관찰·근거 |
| --- | --- | --- |
| THESIS / PC 네 작업창 | match | 1440·1280에서 요청·자료 / 병원·협진 / 이동·동행 / 방문 계획·답변이 2×2이고 4번에 실제 대화가 들어간다. 다섯 번째 채팅 창이 없다. |
| FIRST VIEWPORT / 모바일 읽기 | adaptation | 사용자 선택과 네 작업창 계약에 따라 네 요약 버튼과 선택한 한 창을 표시한다. 390·360·가로 768의 캡처에서 공통 입력으로 이어진다. |
| 공통 예시·입력·고지 | match | 예시는 입력 바로 위에 있으며 입력 하나·음성·보내기와 합성/실제 연락 없음·민감정보 금지·소실 안내가 이어진다. 390×500·768×512는 문서 스크롤로 접근한다. 보이는 조작부가 겹쳐 잘린 증거는 없다. |
| STORY / 실제 진행과 마지막 사실 | match | `app/conversation.js`와 `app/preparation-stages.js`에서 pending progress는 별도 메타데이터이며 caseState의 확인 사실은 최종 응답까지 유지한다. 활동 강조는 실제 running DTO에만 반응하고 timer가 단계를 앞당기지 않는다. 새 모델 네 개·가짜 퍼센트·예약 완료를 표시하지 않는다. 이 행의 실행 근거는 fixture·소스이며 공개 실모델 관측은 별도다. |
| 결과·막힘·담당·조건 재확인 | match | 상태가 ‘결과 있음/확인 필요/재확인’으로 나뉘며 available을 환자 준비완료로 읽히게 하지 않는다. time_changed 캡처의 3번 재확인과 AI 거절의 보호자 인계 문구가 보인다. projection은 병원/이동의 handoff owner와 schedule recheck를 유지한다. 초기 ‘문의처 선택 전 · 문의처 선택 전’ 중복은 사실 오표시·조작 차단이 없어 material fix로 삼지 않았다. |
| 선택·확대·포커스 | match | 단계 선택은 읽기 동작이며 manual selection과 unread answer 경로가 있다. 확대는 열 때 대화 snapshot으로 설명되고 복제 ID·재시도 버튼을 제거하며 닫기 후 원래 조작부에 복귀한다. 캡처와 fresh browser 결과를 결합한 판정이고 보충 expanded 렌더는 미관찰이다. |
| 진행 조회·보관 경계 | match | 단일 awaited poll·2.5초 이상·26회 상한, request/version/token/sequence 가드, 중지/완료/새 대화 해제 경로가 있다. strict enum DTO·토큰 SHA256 키·120초 TTL·별도 bounded I/O와 cold cloud progress-only 경로를 표본 확인했다. 원문·환자·연락처·결과·reasoning을 진행 DTO에 복사하지 않고 polling은 secret/provider/session/budget을 만들지 않는다. 실제 공개 DDB 저장을 검증한 판정은 아니다. |
| TYPE | match | 기존 Pretendard 본문과 MaruBuri 사례 제목의 성격·위계를 유지한다. 작업 본문과 핵심 고지가 읽히며 모바일 입력은 16px 계약이다. 임의 display 글꼴을 넣지 않았다. |
| MATERIAL / OWN-WORLD | match | 지정 hondi 귤 로고와 인물 없는 제주 바다·현무암 raster가 보이며 사진을 CSS 장면으로 대체하지 않았다. 작업면은 표준 웹 조작부로 구성된다. |
| GROUND | match | 계약의 흰 작업면·짙은 녹색·귤색과 밝은 제주 배경을 유지한다. 신규 세계나 임의 따뜻한 종이색으로 갈아엎지 않았다. |
| FORM | match | 사용자 지정 2×2 code-led·모바일 한 창·하나의 입력과 실제 관측 진행이라는 지정을 따른다. `seed: none (user-pinned)`는 사용자 지정 예외이며 누락된 컨셉 승인으로 취급하지 않는다. |

## ceiling

reached — 사용자 지정 Operate 범위에서 정렬된 결과 행·분리된 상태·표준 버튼과 내부 스크롤·읽기 확대로 작업을 수행할 수 있다. 세계관 장식·인물·통계·가짜 진척을 더할 근거가 없다. 제공되지 않은 QUALITY BAR 카드·성공하지 않은 detector의 상한 통과를 주장하지 않는다.

## material_fixes

1. persistence — DESIGN.md의 주 레이아웃·모바일·방문 상세 설명과 sidecar composition을 실제 네 작업창·공통 입력·선택 창·4번 답변/확대·접힌 방문 상세로 맞춘다. 기존 브랜드·토큰·동작 경계와 유효한 이전 규칙은 보존한다. 이는 통합 담당자가 예정한 finish review 이후 documenter 갱신 범위이며, 완료 내용을 같은 reviewer의 verdict pass로 확인한다.

## keep

사용자가 고른 PC2×2·모바일 선택 한 창·입력 하나, hondi 로고·인물 없는 제주 배경·기존 글꼴, 실제 도구 메타데이터와 마지막 확인 사실의 분리, 합성/미연결·인계·재확인·취소의 정보 경계를 유지한다.
