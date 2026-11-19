---
name: 혼디 · 현재 작업 공간
description: 현재 작업과 근거를 읽고 같은 입력에서 진료 준비를 이어가는 화면
colors:
  primary: "#a84d16"
  primary-hover: "#873a10"
  primary-soft: "#fff1e7"
  primary-soft-hover: "#f9e3d3"
  secondary: "#285c43"
  secondary-hover: "#1b4631"
  soft: "#edf6ef"
  ground: "#dce7e2"
  surface: "#fff"
  navigation: "#e5eee8"
  ink: "#262d28"
  muted: "#626d65"
  line: "#e2e7e2"
  input-line: "#b9c9bd"
  disabled-action: "#6b776e"
  signal-good: "#267149"
  warning: "#875617"
  danger: "#a33d34"
typography:
  jeju-entry-title:
    fontFamily: '"Jeju Gothic", Pretendard, sans-serif'
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.4
  jeju-region-title:
    fontFamily: '"Jeju Gothic", Pretendard, sans-serif'
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1.3
  headline:
    fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  headline-compact:
    fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  case-title:
    fontFamily: "Pretendard, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  body:
    fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.85
  input:
    fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  action:
    fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  dialog-title:
    fontFamily: "MaruBuri, serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.025em"
rounded:
  control: "6px"
  input: "8px"
  dialog: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "24px"
  work: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-action}"
    textColor: "{colors.surface}"
  button-draft:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  button-draft-hover:
    backgroundColor: "{colors.primary-soft-hover}"
    textColor: "{colors.primary-hover}"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.input}"
    padding: "10px 12px 6px"
  stage-navigation-selected:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 10px"
---

# Design System: 혼디

## 지역·입력·조건 확인 · 2026-11-17

**2026-11-18 해상도 비율·모션 후속 피드백 우선:** 카드와 조작부에는 불투명한 아이보리·초록·감귤색 작업면을 쓴다. 지역·방식 선택은 고정 1,440px 상한 대신 가용 작업 너비와 창 높이 중 더 제한적인 쪽을 기준으로 글자·여백·버튼을 함께 조절한다. 기준 단위는 `clamp(16px,min(1.6cqw,2.22dvh),44px)`, 결정 영역은 최대 기준 단위80개 폭이다. 브라우저 zoom이나 전체 화면 transform을 사용하지 않는다. 카드 높이는 내용에 따라 정하고, CTA는 기준 단위3개 높이와 문구 폭을 따른다. 520px 이하에서는 짧은 두 행으로 바꾸고 반복 지역명만 CTA에서 생략한다. 요청 예시와 네 조건은 좌우에, 넓은 화면의 공통 입력은 예시 아래에 두며 작성 영역은 280px까지 배분한다. 휴대폰의 16px 입력·44px 조작과 읽기 순서를 유지한다. 실제 다음 단계는 주황색 `다음: …`, 같은 화면 선택은 초록/윤곽선, 뒤로/수정은 낮은 강조다.

**제주 바다와 단계 전환**

지역·준비 방식 선택 화면의 제주 바다 사진과 다음 단계 상단의 같은 사진은 아이보리 바탕에 50% 농도로 표시한다. 시작 질문과 설명, 단계 안내는 사진 위에 직접 놓고 첫 선택지의 왼쪽 선에 본문을 맞춘다. 병원과 준비 방식을 고르는 버튼은 불투명한 색면으로 구분한다. 지역·준비 방식·예약 단계·예약 현황을 바꿀 때는 누른 버튼 자리에 주황색 잔광이 잠시 남고, 손가락이나 포인터가 닿은 곳에서 귤과 과즙이 퍼진다. 다음 화면과 키보드 초점은 바로 사용할 수 있다. 같은 화면의 선택은 누르는 동안 색으로 반응한다. 키보드는 초점 표시를 따르고, 모션 줄이기에서는 움직임 없이 색으로만 반응한다. 상단에서 ‘내 예약 현황’을 다시 열 수 있고, 결과창 하단에는 ‘처음으로’와 ‘내 예약 현황’을 둔다.

**2026-11-18 예약 수정:** 현황·결과창·완료 화면의 보조 행동으로 진입한다. 한 작업면에서 병원·진료과 / 날짜·의료진 / 이동·동행을 고쳐 쓰고 ‘변경 내용 확인’으로 전후를 비교한다. 확인 단계에서는 탭을 숨기고 실제 변경을 먼저 보여준다. 화면 하단에는 취소 또는 수정 계속과 주황색 적용 행동을 유지한다. 작은 화면의 중복 준비 단계 탭은 숨기되 검색·월간 달력·시연 안내와 44px 조작 영역을 보존한다. 적용 전 편집은 기존 예약을 변경하지 않는다.

제주 병원을 고를 때 넓은 화면에서는 왼쪽에서 이름·주소를 검색하거나 지역·진료과를 좁히고, 오른쪽에서 병원명과 주소를 한 줄씩 비교한다. 휴대폰에서는 검색 아래에 목록을 놓는다. 등록 병원은 한 목록에서 끝까지 볼 수 있다. 상세를 열면 전체 주소·등록 진료과·자료 시점·출처를 읽을 수 있고, 병원을 선택하면 그 병원의 진료과를 고를 수 있다.

말이나 글로 요청할 때는 입력 예시 두 개를 보여준다. 예시를 누르면 작성 중인 초안에 더해진다. 달력은 월간 기본과 44px 날짜 조작을 유지한다. 단계별 다음 버튼은 화면 안에 두고, 긴 목록과 펼친 출처는 스크롤해서 읽을 수 있게 한다.

첫 화면은 제주/내륙의 큰 두 선택이다. 다음은 말로·글로·하나씩의 세 행이며, 요청 화면에서는 입력에 따라 병원·일정·서류·이동 네 행을 채운다. 귤의 짧은 진입은 조건을 찾거나 단계를 옮겼다는 피드백이며 reduced motion에서는 생략한다. 기존 공통 입력·하단 행동과 선택 보존을 유지한다.

Headspace의 따뜻한 색면·주 행동 대비와 Linear 공개 홈페이지의 정보 정렬을 참고한다. 바탕은 `#dce7e2`, 왼쪽은 `#e5eee8`, 작업 상단은 `#f5f3eb`, 제주는 `#e5f0e4`, 내륙은 `#faead7`이다. 기존 제주 바다·현무암 생성 이미지를 차분한 바탕으로 드러내며 입력·핵심 선택은 충분한 대비를 둔다. 사용자 지정 혼디 로고·감귤 심볼을 재사용한다.

지역 제목과 현재 작업 제목은 공식 제주고딕, 본문·입력·작은 조작은 기존 Pretendard다. 기본 16px 입력과 44px 조작을 유지한다. 이용 안내·출처·다른 병원·이동 세부를 접어 두고 현재 선택과 다음 행동을 먼저 보여준다. 음성 안내·오류·전송 대상은 중요한 결정 시점에 보인다. [세부 계약·공식 참고](docs/compact-entry-voice-contract.md)를 따른다.

## 서울 대학병원 예약 체험 · 2026-11-16

후속 UX 기준: 의료진을 먼저 고르게 하지 않고 **희망 날짜 하루/기간 → 가능한 의료진·시간 비교**로 진행한다. PC는 월간 달력과 결과를 나란히, 모바일은 같은 DOM에서 순차적으로 읽는다. 항공 검색과 공식 차량 접수 행동을 긴 문의 체크 목록보다 먼저 둔다. 체크박스의 사각형 표시는 20px, 실제 버튼 또는 라벨 행의 조작 영역은 44px 이상으로 분리한다. [날짜 우선·교통 연결 계약](docs/date-first-booking-contract.md)을 따른다.

기존 제주 준비를 보존하면서 진료의뢰서·초진/재진 → 의료진·월별 달력 → 상담/희망 일정 → 회신·항공/왕복 교통으로 이어간다. Next.js/React와 실제 shadcn 컴포넌트를 사용하며 주황 주 행동·초록 선택·흰 작업면·Pretendard를 유지한다. 27개 진료과는 검색 가능한 분류 목록, 의료진은 정렬된 행, 일정은 한 달 달력과 오전/오후 시간으로 구성한다. 인물 사진·실제 의료진 자산은 추가하지 않는다.

사용자의 최신 요청에 따라 **왼쪽 색 막대 박스·반복 경고 상자·장식성 배지·홍보성 제목을 줄인다.** 의뢰서 상태는 평평한 행과 설명, 재확인은 중복 없는 한 문장으로 표시한다. 구분선은 행과 영역을 나누고 색은 선택·행동·오류를 식별하는 데 사용한다. 진료과·일정·교통 변경과 미확인 안내의 의미를 지우지 않는다. 이 기준이 이전 색 막대 스타일보다 우선한다.

서울 흐름은 같은 중앙 스크롤과 단일 입력을 사용하며, 원래 제주 준비/출처 DOM을 숨김·inert로 보존한다. 오른쪽 길잡이는 자료·병원 일정·왕복 이동·요청 준비표를 탐색한다. 기존 준비로 돌아가면 초안·단계·초점·읽기 위치를 복원한다. 요청 접수와 확정 회신은 항상 시연으로 표시하고 실제 예약과 구분한다. 가상 fixture 범위와 새로고침 초기화를 화면에 명시한다. [구현 계약](docs/seoul-appointment-contract.md)을 따른다.

## 선택형 체험 · 2026-11-15

후속 ego lite 사용성 점검에서는 현재 질문·설명·폭이 일정한 두 선택지를 중심에 둔다. 이전 선택과 처리 결과는 `앞선 선택`에서, 동일한 단계 DOM은 `준비 현황과 근거`에서 펼쳐 읽는다. 단계 탐색을 누르면 근거 영역을 열고, 마지막 준비표는 자동으로 펼친다. 시작 전에는 네 단계의 용도만 안내하며 진행 중 표시·잔여 건수를 붙이지 않는다. 실제 응답 뒤에는 기존 업무 상태 projection과 ○△×를 그대로 사용한다.

첫 화면의 `방문 준비 시작`·`직접 요청하기`와 상단 `결과 예시`를 구분한다. PC 왼쪽은232px·오른쪽288px, 현재 질문 영역은 최대760px, 선택지는 최대640px·최소60px 높이다. 체험 중 공통 textarea DOM은 유지하고 비활성 전송·음성·글자 수를 숨겨 하단을 줄인다. 입력 전환은 기존 확인·초안 보존 규칙을 따르고 고지·중지·오류·새 답변은 하단에서 계속 접근한다. 작은 화면에서 글자 자동 축소는 하지 않는다.

중앙 현재 작업 아래 ‘방문 준비 시작’과 단계별 두 답변을 둔다. 질문 → 응답 결과 → 다음 질문 → 준비표 저장으로 이어지며 우측 네 단계는 탐색과 상태를 보여준다. 체험의 ‘지금’ 단계는 준비 완료 여부를 바꾸지 않는다. 기존 공통 입력은 체험 중 읽기 전용이며 자유 입력 전환을 명시한다. 인물 이미지·새 장식 카드·새 색상을 추가하지 않는다.

conversation.css의 `--text-meta/small/ui/body/task`는13/14/15/16/28px, `--target-size`는44px, `--radius-control/input`은6/8px이다. 기존 계산값을 공통 참조로 바꿨으며 반응형 제목·간격의 전체 토큰화나 기존 디자인 체계 교체를 뜻하지 않는다. 체험 답변 선택 버튼은 최소60px이며 세로로 정렬한다. 완료·오류·중지·재시도·초점·출처·원문/합성 경계를 유지한다. 실제 PC·모바일 캡처와 검증 범위는 [후속 개선 기록](docs/reviews/2026-11-15-ego-ui-refinement.md)에 있다.

## Overview

**Creative North Star: "현재 할 일을 잇는 작업면"**

혼디의 작업 화면은 밝은 중성 바탕, 연속된 흰 작업면과 정렬된 행을 사용한다. 실제로 준비할 한 가지를 가장 큰 제목으로 읽고, 담당·단계·시연 여부는 아래의 작은 메타정보로 읽는다. 제주 정체성은 기존 이미지 로고, 이름과 주 행동의 주황, 탐색의 초록과 은은한 해안 배경에 둔다.

[제품 리디자인 계약](docs/product-ui-redesign-contract.md)에 따라 `app/conversation.css`, `app/conversation.js`, `app/preparation-board-view.js`에서 실제 규칙을 추출했다. [공식 제품 참고와 관측 한계](research/product-ui-references-2026-11-05.md)는 Things·Linear·Attio·Front의 공개 이미지/설명을 다루며 로그인 후 제품 사용이나 외부 자산·코드 복제를 뜻하지 않는다. 이전 표면과 검증 이력은 [구현 기록 3.21절과 앞선 절](docs/implementation-results.md#321-실사용과-초기-로딩-개선)에 보존한다.

**Key Characteristics:**

- 현재 작업의 큰 제목과 낮은 위계의 사례·담당 정보.
- 흰 작업면, 얇은 구분선, 선택·보조 반응의 옅은 초록.
- 단일 입력과 같은 상세 DOM을 유지하는 한 화면 공간.
- 문장·SVG 기호·색을 함께 쓰는 준비 상태.

## Colors

주황은 대상과 주 행동, 초록은 탐색과 보조 행동을 구분한다. 정확한 색 값은 frontmatter가 기준이다.

### Primary

- **짙은 귤색** `primary`: 환자 이름, 활성 보내기, 초안 행동의 글자와 키보드 초점. `primary-hover`는 활성 주 행동의 hover/누름 상태다.
- **옅은 귤색** `primary-soft`: 현재 작업의 초안·답변 선택 행동. hover는 `primary-soft-hover`다.

### Secondary

- **짙은 잎색** `secondary`: 탐색, 출처, 음성, 보조 도구와 단계 아이콘. hover 글자는 `secondary-hover`다.
- **옅은 잎색** `soft`: 선택/hover 행과 사용자 메시지. 준비 완료의 의미색으로 대체하지 않는다.

### Neutral

- `ground`는 전체 바탕, `navigation`은 왼쪽 설정면, `surface`는 중앙·입력·읽기 창이다.
- `ink`는 주요 글자, `muted`는 보조 설명, `line`은 영역·행 구분이다. `input-line`은 입력의 기본 테두리다.
- `disabled-action`은 비활성 보내기다. 흐린 주황으로 실행 가능한 인상을 주지 않는다.
- `signal-good`·`warning`·`danger`는 각각 ○ 준비 결과 있음 / △ 추가 확인 / × 막힌 문의의 기호와 문장에 쓴다. 미시작·해당없음은 중립 대시와 설명으로 구분한다.

**The 색의 역할 Rule.** 주황 이름/주 행동, 초록 탐색, 준비 상태의 의미색을 구분한다. ○를 진료·예약·배차 확정으로 표현하지 않는다.

## Typography

**Display Font / Body Font:** Pretendard. 현재 작업 제목도 같은 산세리프다. **Dialog Title Font:** MaruBuri Semibold와 serif fallback.

- **현재 작업:** `headline` / `headline-compact`. 제목 폭은 최대(32ch)이며 좁거나 낮은 작업 공간에서 compact를 사용한다.
- **사례 제목:** `case-title`. 환자 이름만 주황이며 나머지 제목은 본문색이다. 최소 폭에서는(14px)로 바뀐다.
- **작업 설명·모델 답변:** `body`. 작업 설명 최대(68ch), 답변 최대(72ch). 답변의 내부 제목은(18px / 650 / 1.65), 단계 제목은(16px / 600 / 1.6)이다.
- **입력:** `input`. textarea의 글자 크기는 좁거나 낮은 창에서도 줄이지 않는다.
- **메타정보·보조 행동:** `metadata`와 `action`. 단계 행 제목은(14px / 600 / 1.5), 남은 일은(13px / 1.6)이다.
- **읽기 창 제목:** `dialog-title`, 폭(600px) 이하에서는(20px). 레거시 인사/브랜드 텍스트용 serif 규칙을 중앙 작업 제목에 확대 적용하지 않는다.

공식 Pretendard(1.3.9)의 unicode-range CSS와 원본 WOFF2(92개)를 자체 호스팅한다. 전체 폰트 preload를 다시 추가하지 않는다. [폰트 명세와 OFL](app/assets/pretendard/manifest.json), [외부 의존성](THIRD_PARTY.md)을 보존한다.

## Layout

기본 공간은(100dvh)다. body를 늘리거나 글자/화면을 자동 축소하지 않는다. PC는 왼쪽(232px), 중앙 가변폭, 오른쪽(288px)이다. 사례 헤더 최소높이는(68px), 중앙 읽기 여백은(32px), 입력 바깥 여백은(12px 24px 8px)이다. 중앙 grid의 남는 행을 읽기에 배분하고 `auto` 행의 공통 입력을 하단에 둔다. 현재 작업 절은 `position:relative`로 숨김 접근성 제목의 위치 기준을 자체 영역에 둔다.

중앙 현재 작업·선택한 단계·펼친 대화는 한 스크롤 영역이며 오른쪽 네 단계와 방문 상세는 전체 영역으로 스크롤한다. 단계별 내부 스크롤과 복제 상세를 만들지 않는다. 긴 표만 최소폭(32rem)의 가로 스크롤을 가지며 본문·입력 폭을 늘리지 않는다.

| 조건 | 실제 분기 |
| --- | --- |
| 폭 ≤1350px | 키보드 힌트와 헤더 연결 상태를 접는다. 작업 아래 연결/시연 메타정보와 전체 안내는 남는다. |
| 폭 ≤1050px | 왼쪽 설정을 같은 DOM의 서랍으로 전환. 모바일 헤더 최소(52px), 로고 폭(112px), 서랍 폭 `min(320px, calc(100vw - 38px))`. |
| 폭 ≤900px 또는 높이 ≤650px | 같은 할 일/준비 패널을 전환. 헤더 최소(56px), 탭 최소(44px), 중앙 여백(20px 18px), 입력 바깥 여백(10px 12px 6px). 공통 입력은 패널 밖의 하단 행에 남는다. |
| 폭 ≤600px | 읽기 창 폭 `calc(100vw - 24px)`, 상태를 제목 아래로 정렬하고 환자 속성을 한 열로 읽는다. |
| 폭 ≤370px | 작업 메타와 최근 답변 행동을 한 열로 정렬한다. |
| 높이 ≤550px | 보조 사례 설명을 접고 헤더 최소(48px), 입력 높이는(48px)로 제한하며 textarea 안에서 긴 입력을 읽는다. |

패널 비활성 상태는 `hidden`/`inert`와 탭 초점 관리로 처리한다. 초안·열림·출처 DOM·초점·읽기 위치와 새 답변 알림의 계약은 [한 화면 작업 공간](docs/viewport-workspace-contract.md), [현재 할 일](docs/guided-visit-contract.md)을 따른다.

**The 같은 작업면 Rule.** 좁은 창에서도 입력과 단계 내용을 복제하지 않는다. 탐색·초안 선택은 요청 실행과 구분한다.

## Elevation & Depth

기본 작업면·단계 상세·선택 행은 그림자 없이 면·여백·얇은 선으로 구분한다. native dialog에만 `0 20px 64px rgba(28,36,30,.2)`의 그림자와 `rgba(30,36,32,.4)` backdrop을 사용한다. 설정 서랍의 backdrop은 `#202c25a6`다.

현재 앱의 해안 사진은 `/assets/jeju-workspace-background-v1.webp`를 사용하며, 사진 농도는 위 ‘제주 바다와 단계 전환’ 기준을 따른다. 풍경을 큰 배너나 실제 환자·기관 위치의 증거로 사용하지 않는다.

## Shapes

기본 작업/단계면은 사각형이며 선은(1px)이다. `control`은 보내기·초안·선택 행, `input`은 입력/펼친 안내, `dialog`는 읽기 창에 쓴다. 모바일 읽기 창의 실제 곡률은(13px)이다. 내부 행마다 테두리와 둥근 외곽을 중첩하지 않는다.

로고는 `/assets/hondi-logo-v1.png`, 답변 심볼과 favicon은 `/assets/hondi-mark-v1.png`다. 원본 비율·색·투명도를 보존하고 PC 로고 폭은(120px)로 쓴다. 사용자 지정 원본·정확 프롬프트·내보내기·도구/모델 공개 범위는 [자산 명세](app/assets/manifest.json)를 따른다. 인물·의사·장식 의료 심볼을 추가하지 않는다.

## Components

### Buttons

최소 조작 영역은(44px). 보내기는 `button-primary`, 초안은 `button-draft`, 보조 도구는 투명 바탕/잎색 글자와 옅은 잎색 hover다. 보내기 누름은(1px) 내려가며 fine pointer hover에서 화살표만(2px) 움직인다. 비활성 보내기는 `button-primary-disabled`/불투명도(1), 일반 비활성 버튼은(.55), 음성 버튼은(.7)이다. 대기·음성 인식 중 초안 행동도 실제로 비활성화한다.

### Inputs / Fields

공통 입력의 기본 테두리는 `input-line`(1px), focus-within은 `primary` 테두리와 outline(2px / offset 1px)다. textarea 최소높이는(48px), 기본 최대높이는 `min(128px, 16dvh)`이며 내부 세로 스크롤을 사용한다. placeholder는 `muted`/불투명도(1)이다. 보내기·음성·중지/새 답변/오류는 같은 조작 줄에서 읽는다.

### Navigation / Preparation

오른쪽은 네 단계의 행이며 기본 최소높이(76px), compact(72px)다. hover와 `aria-pressed` 읽기 선택은 `soft` 면/`control` 곡률, 실제 현재 단계는 ‘· 지금’, 관측 진행은 잎색 안쪽 밑줄(1px)이다. 선택/현재/진행을 서로 대신하지 않는다. 왼쪽 선택 행도 옅은 잎색과 잎색 글자를 사용한다. 모바일 탭은 선택 시 잎색 밑줄(2px)과 굵은 글자로 구분한다.

### Reading / Status

상세·처리 기록·방문 정보·문의 대상은 native details와 얇은 경계로 펼친다. 전화/기록/여정/넓게 읽기는 제목·닫기와 스크롤 본문을 나눈 native dialog다. 닫기/Escape 뒤 초점 복귀, 모바일 설정 서랍과 모달의 배경 비활성화를 유지한다. 준비 결과와 실제 외부 실행의 설명·출처를 생략하지 않는다.

텍스트 초안은 입력 아래(13px / 1.6)의 잎색 inline status로 알리고 전체 안내를 자동으로 열지 않는다. 실제 음성 피드백은 기존 전체 안내를 열며 오류는 `danger`다. 연결/작성된 예시 상태는 현재 작업 제목 아래, 단계·담당 메타 뒤에 둔다. 요청 오류는(14px / 1.8)의 `danger`, 오류 보기 버튼은 `warning`이며 원문 복구·같은 요청 확인 경계를 보존한다.

### Focus / Motion

버튼·링크·summary·선택·입력의 기본 초점은 `primary` outline(3px / offset 3px), 단계 읽기와 표 스크롤은 `secondary` outline(2px)다. 조작 상태 전환(150ms), 접기 화살표(180ms), 서랍(220ms), 최신 답변 메타의 한 번 피드백(240ms)에 `cubic-bezier(.16,1,.3,1)`을 사용한다. 대기 표식만(1.1s linear) 반복하며 응답 전체는 움직이지 않는다. reduced motion에서는 transition·animation·부드러운 스크롤과 누름/hover 이동을 제거한다. 답변 피드백은 native 종료/취소 표식을 유지해 탭 재방문 때 반복하지 않는다.

**The 서랍 초점 Rule.** 설정 서랍을 열어 둔 채 확대·축소해 초점이 있는 조작이 표시 프레임 밖으로 나가면, 같은 초점을 유지하며 `scrollIntoView({block:'nearest',inline:'nearest'})`로 드러낸다.

## Do's and Don'ts

### Do:

- **Do** 실제 현재 작업을 대표 제목으로 두고 사례·담당·시연 표시는 작은 맥락으로 읽게 한다.
- **Do** 같은 공통 입력, 단계 DOM, 초점·출처·초안·읽기·복구와 전체 안내를 보존한다.
- **Do** 준비 상태에 문장·SVG 기호를 함께 붙이고 시연/실행 없음과 기관 확인이 필요한 일을 남긴다.
- **Do** 검증된 원본 캡처와 같은 소스 지문의 결과를 구분해 기록한다.

### Don't:

- **Don't** 큰 청색 외곽 프레임, 카드 안 카드, 반복 제목·홍보 블록으로 작업을 감싼다.
- **Don't** 인물/의사 이미지·외부 제품 자산을 넣거나 PNG 로고를 임의 문자 로고로 바꾼다.
- **Don't** 작은 창을 맞추려고 글자를 자동 축소하거나 출처·긴 표·고지·닫기·중지를 잘라낸다.
- **Don't** 공개 문의처·합성 응답·준비 결과를 실제 연락·예약·배차·임상 수락으로 표시한다.

이전 검증: 2026-11-05 `functional-final`의 PC 초기/초안과 모바일 체험/전화 원본 4장을 `view_image(detail: original)`로 직접 확인했다. [14뷰 실행 기록](.impeccable/review/chat-rail/product-redesign/functional-final/look.json)은 시작/최종 지문 `bce38fc6312378f397bd87186d74a44cd06a2e2c27b9417f9ab8da55cc35b9bb`에서 pass/오류0/고정 preview2/일반 POST0/모델0을 보고한다. 앞선 round-2의 대표 원본 9장 확인과 구분한다. 당시 독립 ship은 입력 하단 고정과 상태 메타 이동 두 수정의 해결 판정이며 전체 표면 재심사가 아니다.

최신 검증: 2026-11-05 `release-capture`의 PC 초기/초안과 모바일 체험/전화 원본 4장을 같은 original 방식으로 직접 확인했다. [릴리스 14뷰 기록](.impeccable/review/chat-rail/product-redesign/release-capture/look.json)은 시작/최종 지문 `83ba34ae6d299935b2626087639473d7c501f9bb4d50b97a4420573399022184`에서 pass/오류0/고정 preview2/일반 POST0/모델0을 보고한다. 같은 지문의 [native 확대 기록](orchestration/runs/native-zoom-browser.json)은 43/43 통과이며, 문서화 담당이 브라우저나 검사를 재실행한 것은 아니다. [릴리스 독립 검토](.impeccable/review/chat-rail/product-redesign/review/release.md)의 ship도 지정 원본 7장의 입력 하단 고정·상태 메타 위치 두 수정 유지에 한정한다. 비동기 응답·취소·복구 회귀와 다른 기능 검사는 각 실행의 지문·시각을 확인해 [최신 구현 기록](docs/implementation-results.md)에서 별도로 읽는다.

이번에 규칙으로 채택하지 않은 것: 과거 seed·청회색/파란 초점 토큰·미사용 인사 스타일·코드에 없는 합성 tonal ramp. launcher context는 권한126으로 실패했고 detector·seed·roll은 이번 실행에서 미수행이므로 전체 Impeccable 절차 통과를 주장하지 않는다. 실기기·마이크·스크린리더·현재 자유 입력 모델 품질도 이 캡처/문서화의 검증 범위가 아니다.


## 2026-11-16 지역 선택 첫 화면

첫 진입은 큰 제주/내륙 선택 두 개를 좌우로 보여준다. 사용자가 명시한 기능상 두 선택 영역이며 장식용 카드의 반복과 구분한다. 이 시작 화면에서는 오른쪽 단계와 공통 입력을 숨기고 동일 DOM을 보존한다. 준비 중이면 병원/희망 시각과 지역별 이어보기를 표시한다. 초록 제주·옅은 귤색 내륙, 기존 Pretendard와 혼디 로고를 유지한다. 작은 화면에서도 두 지역을 비교하고 각 예약 작업은 기존 단일 스크롤을 따른다. 현재 내륙 체험의 가상 병원·항공 노선은 서울·김포 기준이다. 상세 계약은 `docs/region-booking-contract.md`다.

## 2026-11-16 제주 공개자료를 사용하는 작업 화면

제주 기본 진입은 공개 등록 병원을 찾는 일이다. 데이터 활용 수치를 별도 홍보 카드로 늘어놓지 않고 지역·등록 과목 필터와 기관 행 목록, 월간 희망 달력과 문의 준비표로 연결한다. 지원 문의처도 지역·휠체어 조건을 바꾸면 목록과 선택 이유가 달라지는 정렬된 행으로 보여준다. 출처·기준일은 각 기관의 근거로, 전체 계보는 펼쳐 읽는 보조 정보로 둔다. 실기관에는 가상 의료진·빈자리 상태를 붙이지 않고 명시적인 별도 체험 전환을 제공한다. 이동 화면에서는 체험 모드 전환을 반복하지 않는다. `docs/jeju-data-booking-contract.md`를 따른다.
# 예약 단계·검색 · 2026-11-16

예약 화면의 최신 순서는 병원·진료과 → 의료진·시간 → 접수 확인 → 이동·준비표다. 상단과 오른쪽 단계명을 일치시키고, 선택 요약·이전·주황 다음 버튼을 공통 하단에 둔다. 단순 선택으로 화면을 넘기지 않는다. 달력 아래 의료진·시간 목록은 하단 행동으로 바로 접근하며 뒤로가기와 접수 답변 수정에서 선택한 일정을 보존한다.

병원·진료과·문의 지역은 shadcn Popover/Command 검색과 목록을 함께 제공한다. 실제 제주 병원은 이름·등록 주소 검색도 지원한다. 선택 기관의 등록 진료과와 사용자 희망 의료진·시각을 구분하고, 실제 시간표 없는 기관에 시연 빈자리를 붙이지 않는다. 상세 기준은 [단계 이동·검색 계약](docs/booking-step-search-contract.md)을 따른다.
# 2026-11-17 공개 문의와 AI 요청 연결

공개자료 경로의 단계는 병원·진료과, 희망 의료진·시간, 문의 내용 확인, 이동·준비표다. 실제 접수가 없는 화면에 접수 확인을 붙이지 않는다. 문의/이동 정리 끝에 선택한 내용을 AI 요청 초안으로 옮기는 보조 행동을 둔다. 자동 전송 없이 입력 확인을 제공하고 기존 문장은 보존한다. 공개자료의 오전/오후/정확한 시각 희망은 이동 문구와 저장표에도 유지한다. 좁은 화면의 단계줄은 4칸 안에서 줄바꿈하고 하단 다음 행동은 계속 보인다.
# 예약 진행·완료 화면 · 2026-11-18

마지막 단계는 병원·가는 편 차량·병원 동행의 세 행으로 구성한다. 주 행동은 요청 확인 때 ‘예약 시연 시작’, 진행 중에는 상태와 중지, 종료 후에는 ‘결과표 저장’ 하나다. 초록 체크는 명시적 가상 예약 결과에만 사용하며 인계는 황색 문장으로 구별한다. 선택하지 않은 지원은 제외한다. 서류·항공권·귀가는 별도 준비 안내이며 조율 완료와 혼동하지 않는다. 출처·세부 계획·시연 시나리오는 접는다. 전체 준비 체크 수나 탭 이동을 완료 조건으로 쓰지 않는다. 상세 기준은 `docs/booking-coordination-contract.md`를 따른다.
# 조율 결과 도착 · 2026-11-18

예약 조율이 끝나면 제목·일정·예약 결과·저장이 있는 독립된 결과창을 연다. 큰 감귤과 체크로 완료 순간을 알리며 인계는 갈색 안내로 구분한다. 불투명 작업면·단정한 행·문구에 맞는 버튼 폭을 유지한다. 작은 화면에서는 본문만 스크롤하고 닫기·저장 행동은 고정한다. 단계 이동은 0.85~1.15초 작업면 전환으로 표현하고 키보드·움직임 줄이기는 큰 효과를 생략한다. 세부 상태 경계는 `docs/booking-coordination-contract.md`를 따른다.
