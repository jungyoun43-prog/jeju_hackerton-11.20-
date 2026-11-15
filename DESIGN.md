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
  ground: "#f7f8f7"
  surface: "#fff"
  navigation: "#f5f6f5"
  ink: "#262d28"
  muted: "#626d65"
  line: "#e2e7e2"
  input-line: "#b9c9bd"
  disabled-action: "#6b776e"
  signal-good: "#267149"
  warning: "#875617"
  danger: "#a33d34"
typography:
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

## 선택형 체험 · 2026-11-15

중앙 현재 작업 아래 ‘방문 준비 시작’과 단계별 두 답변을 둔다. 질문 → 응답 결과 → 다음 질문 → 준비표 저장으로 이어지며 우측 네 단계는 탐색과 상태를 보여준다. 체험의 ‘지금’ 단계는 준비 완료 여부를 바꾸지 않는다. 기존 공통 입력은 체험 중 읽기 전용이며 자유 입력 전환을 명시한다. 인물 이미지·새 장식 카드·새 색상을 추가하지 않는다.

conversation.css의 `--text-meta/small/ui/body/task`는13/14/15/16/28px, `--target-size`는44px, `--radius-control/input`은6/8px이다. 기존 계산값을 공통 참조로 바꿨으며 반응형 제목·간격의 전체 토큰화나 기존 디자인 체계 교체를 뜻하지 않는다. 선택 버튼은 최소48px이며 작은 화면에서는 세로로 놓는다. 완료·오류·중지·재시도·초점·출처·원문/합성 경계를 유지한다. 실제 PC·모바일 캡처와 검증 범위는 [이번 평가 기록](docs/reviews/2026-11-15-judge-review.md)에 있다.

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

기본 공간은(100dvh)다. body를 늘리거나 글자/화면을 자동 축소하지 않는다. PC는 왼쪽(224px), 중앙 가변폭, 오른쪽(270px)이다. 사례 헤더 최소높이는(68px), 중앙 읽기 여백은(24px 28px), 입력 바깥 여백은(12px 24px 8px)이다. 중앙 grid의 남는 행을 읽기에 배분하고 `auto` 행의 공통 입력을 하단에 둔다. 현재 작업 절은 `position:relative`로 숨김 접근성 제목의 위치 기준을 자체 영역에 둔다.

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

배경은 `/assets/jeju-workspace-background-v1.webp` 위에 흰색(97%) overlay를 씌우고, 오른쪽은 반투명 흰색(55%)으로 읽는다. 중앙은 불투명 흰색이다. 풍경을 큰 배너나 실제 환자·기관 위치의 증거로 사용하지 않는다.

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
