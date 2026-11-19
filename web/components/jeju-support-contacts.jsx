'use client';
import { useState } from 'react';
import { Check, ExternalLink, Phone } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { useAppointment, Note } from './appointment-context';
import { PublicSelect, JejuSourceDetails } from './jeju-public-booking';
import { JEJU_DATA_AREAS, jejuSupportEvidence } from '../../app/jeju-appointment-data.js';
const labels={taxi:'차량',companion:'동행·돌봄',health:'공공보건'};
export function JejuSupportContacts() {
  const {state,caseState,onAction}=useAppointment(),evidence=jejuSupportEvidence(state,caseState),[kind,setKind]=useState('taxi'),[expanded,setExpanded]=useState(false),rows=evidence[kind];
  const selected=evidence.selected[kind],initial=rows.slice(0,3),visible=expanded?rows:selected&&!initial.some(r=>r.id===selected.id)?[selected,...initial]:initial;
  return <section className="jeju-support-contacts" aria-labelledby="jeju-support-title"><h3 id="jeju-support-title">제주에서 연락할 곳 찾기</h3><p className="appointment-note">{state.region==='jeju'?'집과 병원 사이의 이동, 동행과 지역 지원':'제주공항 왕복 이동, 동행과 귀가 후 지역 지원'}을 준비해요. 소재지·관할이 맞는 문의처부터 보여드려요.</p><div className="jeju-support-filters"><PublicSelect id="jeju-support-area" label="이동·지원 문의 지역" action="jeju_support_area" value={evidence.area} options={JEJU_DATA_AREAS}/><label className="trip-check" htmlFor="jeju-support-wheelchair"><Checkbox id="jeju-support-wheelchair" checked={evidence.wheelchair} onCheckedChange={value=>onAction('jeju_support_wheelchair',value===true,document.getElementById('jeju-support-wheelchair'))}/><span>휠체어 이동 지원을 먼저 보기</span></label></div><Note>문의처 검색 조건이에요. 사례의 주소·지원 필요 여부를 바꾸거나 이용자격을 인정하지 않아요.</Note>
    <div className="public-data-mode" role="group" aria-label="제주 지원 문의 종류">{Object.entries(labels).map(([value,label])=><Button key={value} variant="ghost" aria-pressed={kind===value} onClick={()=>{setKind(value);setExpanded(false);}}>{label}<span className="public-count">{evidence[value].length}</span></Button>)}</div><p className="public-support-context" role="status">{evidence.area} · {labels[kind]} 문의처 {rows.length}곳{selected?` · 선택: ${selected.name}`:''}</p>
    {kind==='companion'&&<Note>2020년 돌봄 등록자료는 병원동행 가능 여부를 담고 있지 않아요. 실제 동행 안내가 있는 별도 공식 서비스와 구분해 보여드려요.</Note>}{kind==='health'&&<Note>제주시 공공보건 등록자료의 관할·소재지 기준입니다. 병원 예약 창구가 아니며 지원·서비스 범위를 먼저 문의해요.</Note>}
    <div className="public-support-list">{visible.map(r=><article key={r.id} className="public-support-row" data-provider-id={r.id}><div><h4>{r.name}</h4><p>{r.matchLabel} · {r.jurisdiction || r.address || r.region}</p><p className="public-support-source">{r.source.datasetId?`제주데이터허브 ${r.source.datasetId}`:'별도 공식 서비스 안내'} · 기준일 {r.source.asOf || '미표시'}</p><div className="public-contact-links"><a href={`tel:${r.phone.replace(/[^0-9+]/g,'')}`}><Phone aria-hidden="true"/>{r.phone}</a><a href={r.source.url} target="_blank" rel="noreferrer">출처<ExternalLink aria-hidden="true"/></a></div></div><Button variant={selected?.id===r.id?'secondary':'outline'} aria-pressed={selected?.id===r.id} aria-label={`${r.name} ${selected?.id===r.id?'선택 해제':'문의처로 선택'}`} onClick={event=>onAction('jeju_support_pick',{kind,id:selected?.id===r.id?null:r.id},event.currentTarget)}>{selected?.id===r.id?<><Check/>선택됨</>:'문의처로 선택'}</Button></article>)}</div>
    {!rows.length&&<div className="appointment-empty"><strong>보유 자료에 이 지역의 문의처가 없어요</strong><p>{kind==='health'?'이 자료는 제주시 범위만 담고 있어요. 서귀포시 기관·서비스의 부재를 뜻하지 않습니다.':'이 지역에 서비스가 없다는 뜻은 아니에요. 문의 지역을 넓혀 다시 찾아보세요.'}</p></div>}{rows.length>3&&<Button variant="ghost" className="public-more" onClick={()=>setExpanded(!expanded)}>{expanded?'간략히 보기':'문의처 모두 보기'}</Button>}
    <Note>선택한 연락처와 출처는 준비표에 담겨요. 현재 운영·제공 범위·요금·이용자격·차량과 인력은 문의가 필요하며, 선택만으로 예약·배차되지 않아요.</Note><JejuSourceDetails/>
  </section>;
}
