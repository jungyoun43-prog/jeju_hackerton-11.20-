// 가상 병원의 탐색용 진료과 목록. 증상에 따라 진료과를 추천하거나 실제 진료 수락을 보장하지 않는다.
export const APPOINTMENT_DEPARTMENT_GROUPS = [
  {name:'내과계',items:[['oncology','종양내과'],['hematology','혈액내과'],['gastroenterology','소화기내과'],['cardiology','심장내과'],['pulmonology','호흡기내과'],['endocrinology','내분비내과'],['nephrology','신장내과'],['infectious','감염내과'],['allergy','알레르기내과'],['rheumatology','류마티스내과']]},
  {name:'외과계',items:[['surgery','외과'],['orthopedics','정형외과'],['neurosurgery','신경외과'],['cardiothoracic','심장혈관흉부외과'],['plastic','성형외과']]},
  {name:'그 밖의 진료과',items:[['neurology','신경과'],['psychiatry','정신건강의학과'],['rehabilitation','재활의학과'],['pain','마취통증의학과'],['obgyn','산부인과'],['pediatrics','소아청소년과'],['dermatology','피부과'],['urology','비뇨의학과'],['ophthalmology','안과'],['ent','이비인후과'],['family','가정의학과'],['radiation','방사선종양학과']]},
];
export const APPOINTMENT_DEPARTMENTS=APPOINTMENT_DEPARTMENT_GROUPS.flatMap(group=>group.items.map(([id,name])=>({id,name,group:group.name})));
