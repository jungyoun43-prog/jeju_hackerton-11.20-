/** 전화 준비만 계산한다. 실제 위임 검증·발신·예약·기록 처리는 수행하지 않는다. */
export const CALL_TARGETS = Object.freeze(['mainland', 'jeju', 'taxi', 'companion']);

const HOSPITAL_SOURCE = 'https://jejudatahub.net/data/view/data/859';
const SUPPORT_SOURCES = Object.freeze({
  call_taxi: {url:'https://www.data.go.kr/data/15056321/fileData.do', datasetId:'327', scope:'linked-public-file', label:'콜택시327 연결 공개 파일'},
  accessible_transport: {url:'https://www.jejuhappycall.com/?mcode=guide01', datasetId:'', scope:'official-service-page', label:'교통약자 이동지원센터 공식 이용 안내'},
  care_contact: {url:'https://jejudatahub.net/data/view/data/254', datasetId:'254', scope:'public-preview', label:'돌봄254 과거 등록 문의처'},
  hospital_escort: {url:'https://www.jjcsc.co.kr/Business/Market', datasetId:'', scope:'official-service-page', label:'병원동행 공식 서비스 소개'},
});
const AREAS = Object.freeze([
  ...['애월읍','한림읍','한경면','구좌읍','조천읍','우도면','추자면','일도1동','일도2동','이도1동','이도2동','삼도1동','삼도2동','용담1동','용담2동','건입동','화북동','삼양동','봉개동','아라동','오라동','연동','노형동','외도동','이호동','도두동'].map(area => `제주시 ${area}`),
  ...['대정읍','남원읍','성산읍','안덕면','표선면','송산동','정방동','중앙동','천지동','효돈동','영천동','동홍동','서홍동','대륜동','대천동','중문동','예래동'].map(area => `서귀포시 ${area}`),
  '제주시', '서귀포시',
]);
const HOSPITAL_STATUSES = Object.freeze({
  not_contacted:['문의 시연 전','협진·의뢰/회송 접수 창구와 자료 준비를 아직 문의하지 않았습니다.'],
  confirmed:['합성 접수 절차 안내','가상 기관의 접수·자료 안내를 재현했습니다. 실제 기관 연결·환자별 진료 수락·협진 참여·예약은 확인하지 않았습니다.'],
  unreachable:['합성 연결 실패','연결 실패를 재현했습니다. 실제 발신이나 기관의 접수 조건 확인은 하지 않았습니다.'],
  not_participating:['합성 접수 미참여 응답','접수를 진행하기 어렵다는 운영 응답을 재현했습니다. 환자의 진료 장소에 관한 임상 판단이 아닙니다.'],
});
const SUPPORT_STATUSES = Object.freeze({
  not_selected:['문의처 선택 전','공개 자료에서 현재 조건에 맞는 문의처를 준비해야 합니다.'],
  selected:['문의처 선택','공개 문의 경로만 선택했습니다. 실제 제공·시간·비용은 미확인입니다.'],
  prepared:['문의 초안 준비','현재 방문 조건의 문의 초안입니다. 실제 기관에 전달하지 않았습니다.'],
  available_demo:['합성 가능 응답','가능 응답을 재현했습니다. 실제 이용자격·회원등록·휠체어 탑승·차량·동행인 확보·예약은 미확인입니다.'],
  unavailable_demo:['합성 불가 응답','지원 불가 응답을 재현했습니다. 다른 문의 경로와 조건을 확인해야 합니다.'],
  unreachable_demo:['합성 연락 실패','연락 실패를 재현했습니다. 실제 발신이나 지원 가능 여부 확인은 하지 않았습니다.'],
  needs_recheck:['조건 변경 후 재확인','방문 조건이 바뀌어 이전 합성 응답을 현재 조건의 확인으로 사용할 수 없습니다.'],
});
const text = (value, max = 300) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value ? value : '';
function administrativeArea(value) {
  const normalized = text(value, 1000).replace(/^제주특별자치도\s+/, '').replace(/\s+/g, ' ');
  return AREAS.find(area => normalized === area || normalized.startsWith(`${area} `)) ?? '';
}
function recipientFor(state, target) {
  if (target === 'mainland' || target === 'jeju') {
    const selected = target === 'jeju' ? state.selectedHospital : null;
    const publicSource = selected?.source?.kind === 'public-preview' && selected.source.datasetId === '859' && selected.source.url === HOSPITAL_SOURCE;
    return {
      name:text(selected?.companyName ?? state.patient[target === 'mainland' ? 'existingHospital' : 'localHospital']) || `${target === 'mainland' ? '기존 도외' : '제주'} 병원 확인 전`,
      role:target === 'mainland' ? '기존 도외 병원의 협진·진료의뢰/회송 행정 창구' : '제주 병원의 현지 진찰·협진 접수 행정 창구',
      phone:null, source:publicSource ? '제주데이터허브859 공개 표본 · 현재 수용 미확인' : '합성 사례의 지정 기관 · 실제 수신처 확인 전',
      sourceUrl:publicSource ? HOSPITAL_SOURCE : null, contactVerified:false, serviceType:'hospital',
    };
  }
  const provider = state.visitSupport?.[target]?.provider;
  const source = Object.hasOwn(SUPPORT_SOURCES, provider?.serviceType) ? SUPPORT_SOURCES[provider.serviceType] : null;
  const knownSource = source && provider?.kind === target && provider.source?.url === source.url
    && provider.source.datasetId === source.datasetId && provider.source.scope === source.scope;
  const phone = knownSource ? text(provider.phone, 80) : '';
  const asOf = knownSource ? date(provider.source.asOf) : '';
  return {
    name:knownSource ? text(provider.name) || '공개 문의처 이름 확인 전' : `${target === 'taxi' ? '이동' : '동행'} 문의처 선택 전`,
    role:target === 'taxi' ? '이동 지원·차량 접수 문의처' : '병원동행 제공·담당 지역 확인 문의처',
    phone:phone && /^[+0-9][0-9()\s./-]*$/.test(phone) ? phone : null,
    source:knownSource ? `${source.label}${asOf ? ` · 기준 ${asOf}` : ''} · 실제 제공 미확인` : '공개 문의처 선택·출처 확인 필요',
    sourceUrl:knownSource ? source.url : null, contactVerified:false, serviceType:knownSource ? provider.serviceType : '',
  };
}
function questionsFor(target, recipient, requirements) {
  let questions;
  if (target === 'mainland') questions = [
    '제주 의료기관과의 협진·진료의뢰/회송을 문의할 행정 창구와 접수 방법은 무엇인가요?',
    '의료진 명의 의뢰서가 필요한지, 접수할 자료의 종류·발급 시점·유효기간은 무엇인가요?',
    '치료 이력·판독문·영상·제주 대면 진찰 소견을 준비할 때 확인할 형식과 전달 방법은 무엇인가요?',
    '환자 본인 또는 적법한 대리인의 확인·자료 공유 동의와 수신 확인 절차는 무엇인가요?',
    '행정 접수 뒤 의료진 검토·환자별 진료 수락 여부는 어느 창구에서 다시 확인하나요?',
  ];
  else if (target === 'jeju') questions = [
    '현지 진찰·검사 문의의 접수 창구와 방문·예약 절차는 무엇인가요? 검사 필요성은 의료진이 판단하나요?',
    '기존 도외 병원과의 협진·진료의뢰/회송 문의를 접수할 창구와 참여 조건은 무엇인가요?',
    '접수할 자료의 종류·발급 시점과 실제 의료진이 작성해야 하는 진찰 소견·의뢰서 준비 절차는 무엇인가요?',
    '도외 병원에 자료를 전달할 창구·방법과 별도 본인 확인·공유 동의·수신 확인 절차는 무엇인가요?',
    '행정 접수 후 의료진 검토와 환자별 진료 수락·예약 여부는 어떻게 따로 확인하나요?',
  ];
  else if (target === 'taxi') {
    questions = [
      '현재 출발 행정지역과 지정 병원 사이를 지원하나요? 희망 날짜·시각의 차량 가능 여부는 어떻게 확인하나요?',
      '출발 시각과 승차 장소를 협의할 접수 절차, 왕복·진료 후 귀가 요청 방법은 무엇인가요?',
      '요금·추가 비용·결제 주체·취소 조건은 무엇인가요?',
    ];
    if (requirements.wheelchair === true || recipient.serviceType === 'accessible_transport') questions.push(
      '이용자격 기준과 확인 서류, 회원등록·사전 신청 절차는 무엇인가요? 나이·병명만으로 자격을 판단하지 않습니다.',
      '휠체어를 탄 채 탑승할 수 있는지, 접어서 탑승해야 하는지와 필요한 차량 유형을 확인할 수 있나요?',
      '승하차·이동 보조를 어느 범위까지 지원하며 동행인도 함께 탑승할 수 있나요?',
      '희망 시각의 휠체어 차량 가능 여부와 실제 승차 위치는 누가 최종 확인하나요?',
    );
  } else {
    questions = [
      recipient.serviceType === 'care_contact' ? '현재 병원동행을 제공하나요? 제공하지 않으면 문의할 다른 기관을 안내받을 수 있나요?' : '현재 병원동행 제공 여부와 담당 지역을 확인할 수 있나요?',
      '이용 대상·자격과 신청 절차, 희망 날짜·시각에 지원 가능한지는 어떻게 확인하나요?',
      '방문·접수·진료·약국·귀가 중 지원 역할과 이동 차량 포함 여부는 무엇인가요?',
      '비용·결제 주체·추가 비용·취소 조건과 담당자 배정 확인 절차는 무엇인가요?',
    ];
    if (requirements.wheelchair === true) questions.push('휠체어 이동·승하차 보조와 차량 동행 탑승을 어느 범위까지 지원하나요?');
  }
  return [...questions, 'AI를 통한 행정 문의 응대가 가능한가요? 어렵다면 사람이 문의할 창구를 안내받을 수 있나요?'];
}
function disclosureFor(state, target) {
  const requirements = state.visitSupport?.requirements ?? {};
  const destination = text(state.selectedHospital?.companyName ?? state.patient.localHospital);
  const values = [
    ['date','방문 희망일',date(state.patient.nextVisit)],
    ['appointmentTime','방문 희망 시각',/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(requirements.appointmentTime ?? '') ? requirements.appointmentTime : ''],
    ['destination','지정한 제주 기관',destination],
  ];
  if (target === 'taxi' || target === 'companion') values.push(
    ['area','출발 행정지역',administrativeArea(state.patient.area)],
    ['wheelchair','휠체어 지원',typeof requirements.wheelchair === 'boolean' ? requirements.wheelchair ? '필요' : '현재 입력에서는 필요 없음' : ''],
    ['companionNeeded','보호자 외 동행 지원',typeof requirements.companionNeeded === 'boolean' ? requirements.companionNeeded ? '필요' : '현재 입력에서는 필요 없음' : ''],
  );
  return values.filter(([, , value]) => value !== '').map(([field,label,value]) => ({field,label,value}));
}

export function buildCallPlan(state, target) {
  if (!CALL_TARGETS.includes(target)) throw new TypeError('전화 준비 대상을 확인해 주세요.');
  if (!state || typeof state !== 'object' || !state.patient || typeof state.patient !== 'object') throw new TypeError('전화 준비 사례를 확인해 주세요.');
  const hospital = target === 'mainland' || target === 'jeju';
  const recipient = recipientFor(state, target), requirements = state.visitSupport?.requirements ?? {};
  const inquiryDelegated = state.permissions?.inquiry === true;
  const statuses = hospital ? HOSPITAL_STATUSES : SUPPORT_STATUSES;
  const rawStatus = hospital ? state.inquiries?.[target]?.status : state.visitSupport?.[target]?.status;
  const status = Object.hasOwn(statuses, rawStatus) ? rawStatus : hospital ? 'not_contacted' : 'not_selected';
  const [label,detail] = statuses[status];
  const purpose = target === 'mainland' ? '기존 도외 병원의 협진·진료의뢰/회송 접수 절차와 자료 준비 확인'
    : target === 'jeju' ? '제주 현지 진찰과 기존 도외 병원을 잇는 협진 접수·자료 전달 절차 확인'
      : target === 'taxi' ? `${requirements.wheelchair === true ? '휠체어 ' : ''}병원 이동 지원의 이용 조건·차량 문의 준비` : '병원동행 제공 여부·지원 역할·시간·비용 문의 준비';
  const recordHandling = {
    recording:'not_configured',transcription:'not_configured',retention:'not_configured',overseasTransfer:'not_verified',
    notice:'실제 녹음·전사·보관 정책은 미설정입니다. 실발신 전에 처리 여부·목적·보관기간·수신자·외부 전송과 거절 방법을 확인하고 안내해야 합니다. 민감정보 제공·국외 이전의 근거와 적합성은 별도 확인 대상입니다.',
  };
  const preCallChecks = [
    {id:'delegation',label:'실제 환자 위임·대리 권한',status:'unverified',detail:'환자 본인 또는 적법한 대리인의 위임 범위·기간·철회 방법을 확인해야 합니다. 성인 자녀의 요청이나 기본 설정으로 권한을 추정하지 않습니다.'},
    {id:'simulation-inquiry',label:'합성 문의 시연 허용',status:inquiryDelegated ? 'simulation' : 'missing',detail:inquiryDelegated ? 'permissions.inquiry는 합성 문의 시연에만 적용됩니다. 실제 환자 동의 검증이 아닙니다.' : '현재 합성 문의 시연도 허용되지 않았습니다.'},
    {id:'recipient',label:'실제 수신처·문의 창구',status:recipient.phone ? 'unverified' : 'missing',detail:recipient.phone ? '공개 대표번호이며 실제 상대·담당 창구·현재 운영 여부는 확인 전입니다.' : '확인한 실제 문의번호가 없습니다. 번호를 만들거나 임의 발신하지 않습니다.'},
    {id:'caller',label:'발신 사업자·발신번호',status:'missing',detail:'실제 발신 어댑터·사업자 계정·발신번호는 설정되지 않았습니다.'},
    {id:'minimum-disclosure',label:'최소 전달 항목·공유 범위',status:'unverified',detail:'최소 항목도 본인 위임·처리 근거와 전달 범위를 확인해야 합니다. 휠체어·승하차 보조 필요는 건강 상태를 추론할 수 있습니다. 실명·나이·진단·기록 본문·환자 연락처·상세 주소는 자동 전달하지 않습니다.'},
    {id:'ai-notice',label:'AI 고지·기관 응대 수락',status:'unverified',detail:'시작할 때 AI임을 밝히고 기관이 이 방식의 문의를 받을 수 있는지 확인해야 합니다. 거절 시 종료·사람의 문의 경로를 확인합니다.'},
    {id:'record-handling',label:'녹음·전사·보관·전송 안내',status:'missing',detail:recordHandling.notice},
    {id:'privacy-basis',label:'민감정보·제3자 제공·국외 이전 근거',status:'unverified',detail:'실제 처리 근거·제공 대상·위탁 및 전송 범위는 별도 검토가 필요합니다. 법적 적합성이 확인된 상태가 아닙니다.'},
    {id:'fees',label:'서비스 비용·수수료 구조',status:'unverified',detail:'실제 비용·수수료·결제 주체는 미확인입니다. 유료 발신이나 결제를 실행하지 않습니다.'},
  ];
  const nextActions = hospital ? [
    '제주·기존 도외 두 기관의 협진·의뢰/회송 행정 창구와 접수 자료를 각각 확인합니다.',
    '보유 자료와 빠진 자료를 정리하고, 실제 대면 진찰 소견·의뢰서는 의료진에게 확인합니다.',
    '자료 공유·수신 확인 절차를 확인한 뒤 의료진 검토·진료 수락·예약 여부를 따로 확인합니다.',
  ] : target === 'taxi' ? [
    '현재 행정지역·희망 시각·휠체어 필요에 맞는 공개 문의 경로와 초안을 준비합니다.',
    '이용자격·등록·탑승 방식·승하차 보조·동행인 탑승과 실제 차량 가능 여부를 확인합니다.',
    '요금·접수·취소 조건을 확인한 뒤 예약·배차 여부를 별도로 확인합니다.',
  ] : [
    '담당 지역·병원동행 제공 여부·희망 날짜와 시각을 확인합니다.',
    '지원 역할·휠체어 보조·이동 차량·비용과 실제 동행인 배정 여부를 확인합니다.',
  ];
  nextActions.push('현재는 준비·합성 시연만 진행하며, 실발신 전 위임·AI 고지·기록 처리·기관 수락을 확인해야 합니다.');
  const supportSubject = recipient.serviceType ? `${recipient.name}의` : '현재 지역의';
  const subject = hospital ? `${recipient.name}의 협진·진료의뢰/회송 접수와 자료 준비`
    : target === 'taxi' ? `${supportSubject} ${requirements.wheelchair === true ? '휠체어 이동 지원 이용자격·등록·탑승·승하차 보조·동행인 탑승·차량 가능 여부' : '병원 이동 지원 조건·희망 시각의 차량 가능 여부'}`
      : `${supportSubject} 병원동행 제공 여부·지원 역할·시간·비용`;
  return {
    version:1,target,recipient,purpose,questions:questionsFor(target,recipient,requirements),minimumDisclosure:disclosureFor(state,target),
    excludedInformation:['환자 실명·나이','진단명·병력·검사 결과·의료기록 본문','주민등록번호 등 고유식별정보','실제 환자·보호자 연락처','환자의 상세 주소','API 키·인증정보'],
    openingScript:`[실발신 전 위임·수신처·기록처리 확인 후 사용할 예정 문구 · 현재 발신 없음] 안녕하세요. 제주 진료 나침반의 AI 전화 도우미입니다. 오늘 문의 목적은 ${purpose}입니다. AI를 통한 행정 문의에 응대하실 수 있는지 먼저 확인해 주시겠습니까? [실제 확인한 위임 범위와 녹음·전사 여부, 목적·보관기간·외부 전송·거절 방법을 여기서 안내한 뒤 기관이 수락한 범위로 진행합니다. 현재 해당 정책은 미설정입니다.]`,
    recordHandling,preCallChecks,simulation:{inquiryDelegated,status,label,detail},nextActions,
    requestDraft:`현재 방문 조건을 기준으로 ${subject}에 관한 AI 전화 시연을 준비해 줘. 실제 발신 없이 위임·최소 전달정보·AI 고지·기록 처리 확인사항과 다음 준비를 정리해 줘.`,
    realDelegationVerified:false,realAdapterConfigured:false,actualCallPlaced:false,reservationConfirmed:false,clinicalAcceptanceConfirmed:false,
  };
}
