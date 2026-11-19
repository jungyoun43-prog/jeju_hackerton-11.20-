# 항공권·택시·휠체어 이동 접수 연결

확인: 2026-11-16 KST. ego lite에서 공식 원문과 실제 공개 검색/로그인 화면을 읽었다. 검색 스니펫만으로 채택하지 않았다. 로그인·결제·전화 발신·차량 접수는 하지 않았다.

## 항공권

사용자가 **가격 비교 사이트로 이동해 예약**을 선택했다. 혼디는 운임을 만들어 보여주거나 외부 예약 완료를 추정하지 않는다.

- [스카이스캐너 공식 링크 설명](https://developers.skyscanner.net/docs/referrals/overview), [예시](https://developers.skyscanner.net/docs/referrals/examples): 날짜·출발지·목적지로 검색 화면을 연결하는 방식과 제휴 추적을 구분한다. 제휴 ID·라이브 가격 API는 구성하지 않았다.
- 공개 검색 페이지 `https://www.skyscanner.co.kr/transport/flights/cju/gmp/261207/261210/?adults=1&cabinclass=economy&rtn=1`을 실제 열어 **제주(CJU)–서울(GMP), 12월 7일 출발·12월 10일 귀가, 성인 1명 일반석**이 반영된 검색 화면을 확인했다. 이때 가격 결과가 아직 검색 중이어서 특정 운임·좌석·최저가를 검증했다고 보고하지 않는다.
- `app/appointment-booking-links.js`는 같은 공개 검색 URL만 만든다. 날짜·공항·성인 인원·일반석 이외의 환자/병원/진료과/문서 정보를 넣지 않는다. `noreferrer`를 사용하고 사용자 클릭 시에만 외부로 이동한다.
- 처음 시도한 `/docs/affiliate-links/overview` 경로는 AccessDenied였다. ego 검색으로 확인한 실제 `/docs/referrals/overview` 경로의 원문은 정상 열렸다. 기본 웹 도구·insane-search로 대체하지 않았다.

## 일반 택시

[카카오모빌리티 공식 택시 안내](https://www.kakaomobility.com/service-kakaot/taxi)에서 카카오 T 앱의 호출·예약·결제, 벤티·블랙의 예약 가능 표시와 앱 설치 링크를 확인했다. 지역·차종별 실제 공급은 확인하지 않았다. 따라서 **카카오 T 예약·앱 안내**로 연결하며 제주와 서울 어디서나 원하는 차종이 예약된다고 표시하지 않는다. 제주 공개 문의 후보의 기존 전화번호는 사용자 전화 연결 버튼으로 제공한다. 실제 발신은 없다.

## 휠체어 탑승 차량

- [제주 이용안내](https://www.jejuhappycall.com/?mcode=guide01), [접수방법](https://www.jejuhappycall.com/?mcode=guide03): 사전 회원등록, 당일 전화/인터넷 즉시콜, 별도 다인승 접수 등을 구분한다. [즉시콜 접수](https://www.jejuhappycall.com/reservation?mcode=res01)는 로그인 화면으로 연결되는 것까지 확인했다. 문의 번호 1899-6884. 미래 날짜의 일반 차량 확정 예약으로 표현하지 않는다.
- [서울 이용기준](https://www.sisul.or.kr/open_content/calltaxi/introduce/receipt.jsp): 이용대상과 등록, 바로콜·조건부 전일 접수 등 구분을 확인했다. [인터넷 콜접수](https://www.sisul.or.kr/open_content/calltaxi/guidance/internet.jsp)는 로그인 화면이다. 문의 번호 1588-4388. 제주 등록이 서울에도 적용된다고 가정하지 않는다.
- 사용자가 휠체어 이동을 선택하면 해당 지역의 공식 접수와 자격 안내를 보여준다. 나이·병명만으로 자격을 인정하거나 접수를 배차 확정으로 바꾸지 않는다. 차량 신청은 외부 서비스에서 사용자가 진행한다.

## 구현 경계

검색 링크와 공식 접수 창구 연결은 실제 동작이다. 병원 시간표는 계속 합성 데이터이며, 혼디 내부 실시간 운임·좌석·차량 조회·배차·결제·예약 결과 수신은 미연동이다. 외부 페이지 UI와 URL은 변경될 수 있다. 신규 공식 링크를 제주 데이터허브 원자료 또는 신규 공공데이터 분석 건수로 세지 않는다.
