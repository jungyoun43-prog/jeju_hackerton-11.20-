# 제주 밖에서 진료받은 도민과 혼디의 기관 연동 계획

2026년 11월 19일 원문을 확인했다. 아래 통계는 기획 배경에 사용한다. 서비스가 병원과 문의처를 찾을 때 사용하는 제주데이터허브 계보 네 종과는 별도 자료다.

## 제주 거주자의 도외 진료

국민건강보험공단 『2025 지역별 의료이용 통계연보』 전국편 제5-3표 「시도별 진료현황(관외)」의 제주 소계는 **140,203명**이다. 인쇄본 22쪽(PDF 56쪽)의 진료실인원수 열과 첨부 엑셀 `01_전국시도_2025.xlsx`의 `22p!C74`를 대조했다. 공단 게시일은 2026년 11월 2일이다. [공식 PDF 게시물](https://www.nhis.or.kr/nhis/together/wbhaec06900m01.do?mode=view&articleNo=11014719) · [제5-3표 원문](https://www.nhis.or.kr/nhis/together/wbhaec06900m01.do?mode=download&articleNo=11014719&attachNo=370096#page=56) · [엑셀 원표](https://www.nhis.or.kr/nhis/together/wbhaec06900m01.do?mode=view&articleNo=11014718)

공단은 진료일과 연도 말 실제 거주 시·도를 기준으로 관내·관외를 구분한다. 이 표에서는 건강보험·의료급여 대상자 가운데 제주에 거주하며 제주 밖 의료기관에서 진료받은 전 연령의 사람 수를 읽었다. 의료이용 지표에서는 약국을 제외한다. 입원과 외래의 소계를 더하면 같은 사람이 겹칠 수 있어 공단이 공표한 제주 소계 한 칸을 사용했다. 고령 부모의 수, 자녀의 거주지, 내륙 방문 횟수·항공 이용·숙박 여부는 이 표로 알 수 없다. [공식 해설서 666쪽, PDF 18쪽](https://www.nhis.or.kr/nhis/together/wbhaec06900m01.do?mode=download&articleNo=11014718&attachNo=370095#page=18)

서울에 사는 딸이 애월에 사는 어머니의 진료를 준비하는 이야기는 가상 사례다. 제주특별자치도가 2025년에 발간한 『제주특별자치도 지속가능발전 추진계획』(2025~2030)에도 도외 진료에 따르는 의료이용 불편과 비용 부담을 줄이는 과제가 제시돼 있다. [제주도의회 공개 문서, 보건정책과 사업 34쪽](https://record.council.jeju.kr/CLRecords/Files/FileAppendix/a12/A046827.pdf#page=38)

## 연락 수단과 제공 주체

운영자용 코드에는 Twilio가 상대 번호로 발신하고 Media Streams를 통해 OpenAI Realtime과 통화 음성을 주고받는 경로가 있다. 모의 공급자와 시험했으며 실제 전화 회선이나 기관 예약으로 검증한 것은 아니다. 보호자가 브라우저에서 AI와 나눈 음성 대화는 별도 기능이다. 기관 담당자가 일반 번호로 다시 걸어온 전화를 받아 기존 요청을 찾는 기능은 후속 개발 범위다. [운영자 코드의 작동 조건](../docs/outbound-phone-adapter.md) · [Twilio 양방향 음성](https://www.twilio.com/docs/voice/media-streams) · [Twilio 발신·수신 처리](https://www.twilio.com/docs/voice/twiml)

기관이 이미 예약·접수 API를 운영하거나 새로 제공하는 경우, 합의한 작업을 MCP(Model Context Protocol) 도구로 노출하는 방법을 제안한다. 가족이 허용한 필드와 시간을 보내고 기관의 접수·대안·거절을 원래 일정으로 돌려주는 설계다. 기관별 권한, 연락 창구, 변경·철회 방식과 데이터 처리 조건을 정해야 한다. 현재 기관 협약·운영 MCP 서버·직접 객실 예약은 없다. [MCP 공식 아키텍처와 도구 실행](https://modelcontextprotocol.io/docs/learn/architecture)
