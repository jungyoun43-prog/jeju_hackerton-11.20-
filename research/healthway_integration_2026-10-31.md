# 건강정보 고속도로 연계와 환자 기록 표시 범위

확인일: 2026-10-31. 환자 정보·건강 기록 설정 창을 추가하는 과정에서 공식 공개 안내만 확인했다. 환자 로그인·동의·개인 기록 조회·기관 이용 신청은 수행하지 않았다.

## 공식 확인

| 공개 원문 | 확인한 사실 | 이번 구현에 반영 |
| --- | --- | --- |
| [개인사용자 서비스 소개](https://www.myhealthway.go.kr/portal/index?page=Individual%2FPortal%2FMediMyData%2FMydataService) | 개인 의료데이터 열람과 본인 동의에 따른 전송을 지원하는 중계 체계 | 이 앱의 합성 사례를 플랫폼에서 수신한 개인 기록으로 표시하지 않는다 |
| [기관사용자 API 소개](https://www.myhealthway.go.kr/portal/index?page=Organization%2FPortal%2FMediMyData%2FMydataApi) | 의료·공공데이터 조회, 제공·활용 동의, 본인인증·연계지원 등 API 역할이 나뉜다 | 일반 모델 연결·문의 위임·기록 공유 시연을 실제 건강정보 조회 동의로 해석하지 않는다 |
| [서비스 이용신청](https://www.myhealthway.go.kr/portal/index?page=Organization%2FPortal%2FPortalFunction%2FOrFunctionServiceUse) | 활용기관은 테스트 신청 후 운영 신청 단계를 거친다 | 공공 병원·택시 자료와 별개인 개인 기록 연계다. 공식 연계가 없는 현재는 ‘미연결·최근 불러오기 없음’이다 |

원문은 insane-search `engine.fetch`와 `to_untrusted_text()`로 각각 한 번 수집했고 세 건 모두 ok:true였다. 개발환경 `/tmp/jeju-healthway-official/`에 원문을 보관하며, 사이트 전체·인증 후 API 명세·기관 승인 여부를 검증한 결과가 아니다. 검색 결과의 요약과 실제 읽은 원문을 대조했다.

## 현재 표시와 후속 경계

환자 창은 기존 Agent 응답의 `caseState.patient`와 `caseState.documents`를 읽는다. 합성 치료 이력, 준비된 문서, 미확보 판독문, 실제 진찰이 필요한 기록을 구분한다. 조회하지 않은 약물·검사결과·진단 세부사항을 ‘없음’으로 판단하거나 새로 만들어 표시하지 않는다.

건강정보 고속도로 연결 상태는 별도 어댑터가 없으므로 미연결이다. 일반 `capabilities.healthRecords` 값만으로 이 특정 서비스의 수신 성공·최근 동기화 시각을 만들지 않는다. 공식 안내 링크를 여는 행위도 데이터 조회·본인 동의를 뜻하지 않는다.

실제 연계 시에는 승인된 서버 연결, 본인인증, 유효한 제공·활용 동의와 보호자 권한, 제공기관·자료 시점·수신 여부를 구분하는 계약을 먼저 구현·검증해야 한다. 현재의 공개 병원·이동·돌봄 데이터 활용을 중단하거나 별도 사용권을 요구하는 근거로 쓰지 않는다.
