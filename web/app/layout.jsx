import './ui.css';
import '../../app/conversation.css';
import '../../app/appointment.css';
import './appointment-react.css';
import './care-entry.css';
import './coordination.css';
import './reservations.css';
import './care-motion.css';
export const metadata = {
  title: '혼디 · 대화로 준비하는 가족 진료',
  description: '제주 현지 진료와 도외 진료의 자료·예약 상담·왕복 이동 준비를 이어갑니다.',
  icons: { icon: '/assets/hondi-mark-v1.png' },
};
export const viewport = { width:'device-width',initialScale:1,themeColor:'#F4F7F5' };
export default function RootLayout({children}) {
  return <html lang="ko"><head><link rel="stylesheet" href="/assets/pretendard/pretendardvariable-dynamic-subset.css" /></head><body><a className="skip-link" href="#main">본문으로 바로가기</a>{children}<noscript>이 화면을 사용하려면 JavaScript를 활성화해 주세요.</noscript></body></html>;
}
