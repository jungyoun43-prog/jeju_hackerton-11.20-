'use client';
import { useEffect } from 'react';
import { renderAppointment } from '../components/appointment-root';
import { renderRegionStart } from '../components/care-region-start';

// 대화 컨트롤러가 소유한 DOM은 이 경계 안에 보존한다. 예약 영역은 React가 소유한다.
export default function Home() {
  useEffect(() => {
    window.__hondiBoot ??= import('../../app/conversation.js').then(module=>module.mount({renderAppointment,renderRegionStart}));
    window.__hondiBoot.catch(()=>{
      const host=document.getElementById('app');
      if(!document.getElementById('main'))host.textContent='화면을 불러오지 못했어요. 새로고침해 다시 시도해 주세요.';
    });
  },[]);
  return <div id="app" data-framework="next-react"><div className="startup">진료 준비 대화를 불러오고 있어요.</div></div>;
}
